import { respond, withJiraError } from "../utils.js";
import { checkVersion, contentVersion, fetchContent } from "../shared/contentVersion.js";
import { addSmartLinks, formatSmartLinkReport, parseProjects, smartLinkOptionsFromEnv, } from "../shared/smartLinks.js";
export const addSmartLinksDefinition = {
    name: "add-smartlinks",
    description: "Turn mentions of Jira issues and Confluence pages in a description or comment that is already in Jira into smart-link cards (key, summary, live status), in place: links and bare URLs to issues and pages on this site, bare issue keys of the configured projects, and optionally #1234 as a pull-request link. Everything else round-trips untouched, so this is the way to fix plain links in someone else's text without rewriting it. Reports every change, and every key it left alone because it is glued to a word. Note that it edits a comment even when someone else wrote it.",
    inputSchema: {
        type: "object",
        properties: {
            issueKey: { type: "string" },
            commentId: {
                type: "string",
                description: "Patch this comment instead of the ticket description. Comment IDs are shown by get-ticket-details."
            },
            dryRun: {
                type: "boolean",
                description: "Only report what would change; write nothing. Defaults to false."
            },
            projects: {
                type: "array",
                items: { type: "string" },
                description: "Project keys whose bare issue keys (ABC-123) become cards. Defaults to the server's JIRA_SMARTLINK_PROJECTS; without either, bare keys are left alone."
            },
            prRepo: {
                type: "string",
                description: "A GitHub repository as owner/repo: a bare #1234 becomes a link to that repository's pull request. Off by default."
            }
        },
        required: ["issueKey"]
    }
};
function countTypes(doc, counts = {}) {
    if (doc && typeof doc === "object") {
        counts[doc.type] = (counts[doc.type] ?? 0) + 1;
        for (const child of doc.content ?? [])
            countTypes(child, counts);
    }
    return counts;
}
/** Node types whose count changed, e.g. "text 12 -> 14, inlineCard 0 -> 3". */
function typeDelta(before, after) {
    const a = countTypes(before);
    const b = countTypes(after);
    return Object.keys({ ...a, ...b })
        .filter((type) => a[type] !== b[type])
        .map((type) => `${type} ${a[type] ?? 0} -> ${b[type] ?? 0}`)
        .join(", ");
}
export async function addSmartLinksHandler(jira, args) {
    const { issueKey, commentId, dryRun = false, prRepo } = args;
    const label = commentId ? `comment ${commentId} on ${issueKey}` : `description of ${issueKey}`;
    return withJiraError(async () => {
        const options = smartLinkOptionsFromEnv();
        if (!options) {
            return respond("Error: JIRA_HOST is not a valid URL, so there is no telling which links point at this site.");
        }
        if (args.projects !== undefined) {
            const parsed = parseProjects(args.projects);
            if ("error" in parsed)
                return respond(`Error: ${parsed.error}.`);
            options.projects = parsed.projects;
        }
        if (prRepo !== undefined) {
            if (!/^[\w.-]+\/[\w.-]+$/.test(prRepo))
                return respond(`Error: prRepo must be owner/repo, got "${prRepo}".`);
            options.prRepo = prRepo;
        }
        const { adf, visibility } = await fetchContent(jira, issueKey, commentId);
        if (!adf)
            return respond(`The ${label} is empty — nothing to link.`);
        const version = contentVersion(adf);
        const doc = structuredClone(adf);
        const report = addSmartLinks(doc, options);
        const lines = [`Smart-links in the ${label} (version ${version}):`, ...formatSmartLinkReport(report)];
        if (!options.projects.length) {
            lines.push("Bare issue keys were not looked for: set JIRA_SMARTLINK_PROJECTS or pass projects.");
        }
        if (report.skipped.length) {
            lines.push("To link a skipped key, rephrase its sentence (export-content, edit, update-description / update-comment) and run add-smartlinks again.");
        }
        // Only text and inlineCard should change; anything else means the content was not what it seemed.
        lines.push(`${report.changes.length} change(s); node types changed: ${typeDelta(adf, doc) || "none"}`);
        if (!report.changes.length)
            return respond([...lines, "Nothing to write."].join("\n"));
        if (dryRun)
            return respond([...lines, "Dry run: nothing written. Run again without dryRun to apply."].join("\n"));
        // The patch is based on what was just read; refuse it if someone edited in between.
        const conflict = await checkVersion({ jira, issueKey, commentId, expectedVersion: version });
        if (conflict)
            return respond(conflict);
        if (commentId) {
            await jira.issueComments.updateComment({
                issueIdOrKey: issueKey,
                id: commentId,
                body: doc,
                ...(visibility ? { visibility } : {}),
            });
        }
        else {
            await jira.issues.editIssue({ issueIdOrKey: issueKey, fields: { description: doc } });
        }
        const newVersion = contentVersion((await fetchContent(jira, issueKey, commentId)).adf);
        lines.push(`Updated the ${label}. New version: ${newVersion} — pass this as expectedVersion for the next patch.`);
        return respond(lines.join("\n"));
    }, `Error adding smart-links to ${issueKey}`);
}
