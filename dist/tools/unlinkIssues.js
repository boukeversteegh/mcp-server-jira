import { respond, validateArray, withJiraError } from "../utils.js";
import { findLinkType, linkRelationFor, listLinkTypes } from "./linkTickets.js";
export const unlinkIssuesDefinition = {
    name: "unlink-issues",
    description: "Remove links between issues, in either direction. Without targetKeys, removes the issues' links to any issue; without linkType, links of every type.",
    inputSchema: {
        type: "object",
        properties: {
            issueKeys: {
                type: "array",
                items: { type: "string" },
                description: "Issues to remove links from"
            },
            targetKeys: {
                type: "array",
                items: { type: "string" },
                description: "Target issues to unlink. If omitted, removes all links from the issues."
            },
            linkType: {
                type: "string",
                description: "Only remove links of this type. Matched like link-issues does: the name ('Blocks' or '3. Blocks'), or its inward or outward description ('is blocked by'). If omitted, removes all link types."
            }
        },
        required: ["issueKeys"]
    }
};
export async function unlinkIssuesHandler(jira, args) {
    const { issueKeys, targetKeys, linkType } = args;
    const issuesErr = validateArray("issueKeys", issueKeys);
    if (issuesErr)
        return respond(issuesErr.replace("array", "array of issue keys"));
    const targetSet = targetKeys ? new Set(targetKeys) : null;
    return withJiraError(async () => {
        let matched;
        if (linkType) {
            const available = (await jira.issueLinkTypes.getIssueLinkTypes()).issueLinkTypes ?? [];
            matched = findLinkType(available, linkType);
            if (!matched) {
                const response = respond(`Link type "${linkType}" not found. Use the exact name shown in quotes below as the linkType value:\n${listLinkTypes(available)}`);
                response.isError = true;
                return response;
            }
        }
        const sameType = (t) => t?.id && matched?.id ? t.id === matched.id : (t?.name ?? "").toLowerCase() === (matched?.name ?? "").toLowerCase();
        const results = [];
        const errors = [];
        for (const issueKey of issueKeys) {
            try {
                // Fetch issue with links
                const issue = await jira.issues.getIssue({
                    issueIdOrKey: issueKey,
                    fields: ["issuelinks"]
                });
                const links = issue.fields.issuelinks || [];
                for (const link of links) {
                    // Filter by link type if specified
                    if (matched && !sameType(link.type))
                        continue;
                    // Get the linked issue key (could be inward or outward)
                    const linkedKey = link.inwardIssue?.key || link.outwardIssue?.key;
                    if (!linkedKey)
                        continue;
                    // If targetKeys specified, only remove links to those targets
                    if (targetSet && !targetSet.has(linkedKey))
                        continue;
                    // Delete the link
                    if (link.id) {
                        try {
                            await jira.issueLinks.deleteIssueLink({ linkId: link.id });
                            const relation = linkRelationFor(link) ?? "linked to";
                            results.push(`${issueKey} ${relation} ${linkedKey} [${link.type?.name}, id:${link.id}]`);
                        }
                        catch (e) {
                            errors.push(`${issueKey} <-> ${linkedKey}: ${e?.message ?? String(e)}`);
                        }
                    }
                }
            }
            catch (e) {
                errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
            }
        }
        let msg = matched ? `Link type filter: "${matched.name}"\n` : "All link types\n";
        if (results.length > 0) {
            msg += `Removed ${results.length} links:\n` + results.join("\n");
        }
        else if (errors.length === 0) {
            msg += "No matching links found to remove.";
        }
        if (errors.length > 0) {
            if (results.length > 0)
                msg += "\n\n";
            msg += `Failed ${errors.length} operations:\n` + errors.join("\n");
        }
        const response = respond(msg);
        if (errors.length > 0 && results.length === 0)
            response.isError = true;
        return response;
    }, "Error unlinking issues");
}
