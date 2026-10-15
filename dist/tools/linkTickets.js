import { respond, withJiraError } from "../utils.js";
export const linkIssuesDefinition = {
    name: "link-issues",
    description: "Link multiple tickets using a specified link type. Every outward key is linked to every inward key, read as '<outward key> <outward description> <inward key>': with linkType 'Blocks', outwardIssueKeys are the blockers and inwardIssueKeys the blocked issues ('A blocks B'). Existing links are detected and never duplicated: the result reports which links were created and which were already present. For asymmetric link types (e.g. 'Blocks'), an existing link in the opposite direction is reported as a conflict instead of being created (override with allowReciprocal).",
    inputSchema: {
        type: "object",
        properties: {
            inwardIssueKeys: {
                type: "array",
                items: { type: "string" },
                description: "Issues on the inward side, described by the type's inward text (for 'Blocks': the issues that are blocked)"
            },
            outwardIssueKeys: {
                type: "array",
                items: { type: "string" },
                description: "Issues on the outward side, described by the type's outward text (for 'Blocks': the issues that block)"
            },
            linkType: {
                type: "string",
                description: "Name of the link type, e.g. 'Blocks', 'Relates', 'Duplicates'. Defaults to 'Relates'. If the type is not found, available types are listed."
            },
            allowReciprocal: {
                type: "boolean",
                description: "For asymmetric link types, allow creating a link when the opposite-direction link already exists (e.g. A blocks B and B blocks A). Defaults to false, which reports a conflict instead."
            }
        },
        required: ["inwardIssueKeys", "outwardIssueKeys"]
    }
};
const norm = (s) => s.trim().toUpperCase();
/** Directed pair key: `outward` <type.outward> `inward`, e.g. "A blocks B". */
const pairKey = (outward, inward) => `${norm(outward)}=>${norm(inward)}`;
/**
 * Resolve a link type by its name, its name without the numeric prefix some sites use
 * ("3. Blocks" -> "blocks"), or its inward or outward description. Case-insensitive.
 */
export function findLinkType(available, linkType) {
    const needle = linkType.trim().toLowerCase();
    const stripPrefix = (s) => s.replace(/^\d+\.\s*/, "").toLowerCase();
    return available.find((lt) => lt.name?.toLowerCase() === needle ||
        stripPrefix(lt.name ?? "") === needle ||
        lt.inward?.toLowerCase() === needle ||
        lt.outward?.toLowerCase() === needle);
}
export function listLinkTypes(available) {
    return available.map((lt) => `  - "${lt.name}" (inward: "${lt.inward}", outward: "${lt.outward}")`).join("\n");
}
/**
 * How Jira's link fields map to the relation the UI shows (checked against the Jira UI):
 *  - In a link itself (the create request body and GET /issueLink/{id}), `inwardIssue` is the
 *    issue the *outward* description is about: { inwardIssue: A, outwardIssue: B } on
 *    "Blocks" is shown as "A blocks B".
 *  - In an issue's own `issuelinks`, only the other end appears, under that end's field:
 *    on issue X, `outwardIssue: Y` reads "X <outward> Y" and `inwardIssue: Y` reads
 *    "X <inward> Y".
 */
export function linkRelationFor(link) {
    return link.outwardIssue ? link.type?.outward : link.type?.inward;
}
export async function linkIssuesHandler(jira, args) {
    const { inwardIssueKeys, outwardIssueKeys, linkType = "Relates", allowReciprocal = false } = args;
    return withJiraError(async () => {
        if (!Array.isArray(inwardIssueKeys) || inwardIssueKeys.length === 0) {
            return respond("Error: inwardIssueKeys must be a non-empty array of issue keys.");
        }
        if (!Array.isArray(outwardIssueKeys) || outwardIssueKeys.length === 0) {
            return respond("Error: outwardIssueKeys must be a non-empty array of issue keys.");
        }
        const linkTypesResponse = await jira.issueLinkTypes.getIssueLinkTypes();
        const available = linkTypesResponse.issueLinkTypes ?? [];
        const matched = findLinkType(available, linkType);
        if (!matched) {
            return respond(`Link type "${linkType}" not found. Use the exact name shown in quotes below as the linkType value:\n${listLinkTypes(available)}`);
        }
        /** "A blocks B" */
        const says = (outward, inward) => `${outward} ${matched.outward} ${inward}`;
        // Symmetry is derived from Jira's own definition of the link type: a type whose
        // inward and outward descriptions are identical (e.g. "relates to"/"relates to")
        // describes the same relation in both directions, so A->B and B->A are one link.
        const symmetric = (matched.inward ?? "").trim().toLowerCase() === (matched.outward ?? "").trim().toLowerCase();
        const sameType = (t) => t?.id && matched.id ? t.id === matched.id : (t?.name ?? "").toLowerCase() === (matched.name ?? "").toLowerCase();
        // Directed pairs ("A blocks B") of this link type that already exist,
        // for the issues we are about to link from. Populated lazily, one fetch per issue.
        const existing = new Set();
        const loaded = new Set();
        const loadLinks = async (issueKey) => {
            if (loaded.has(norm(issueKey)))
                return;
            const issue = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["issuelinks"] });
            const self = issue.key ?? issueKey;
            for (const link of issue.fields?.issuelinks ?? []) {
                if (!sameType(link.type))
                    continue;
                // See linkRelationFor: on issue X, `outwardIssue: Y` reads "X blocks Y" and
                // `inwardIssue: Y` reads "X is blocked by Y", i.e. "Y blocks X".
                if (link.outwardIssue?.key)
                    existing.add(pairKey(self, link.outwardIssue.key));
                if (link.inwardIssue?.key)
                    existing.add(pairKey(link.inwardIssue.key, self));
            }
            loaded.add(norm(issueKey));
            loaded.add(norm(self));
        };
        const created = [];
        const skipped = [];
        const conflicts = [];
        const errors = [];
        // Create cross-product links: every outward key <outward description> every inward key
        for (const outward of outwardIssueKeys) {
            for (const inward of inwardIssueKeys) {
                if (norm(outward) === norm(inward)) {
                    errors.push(`${says(outward, inward)}: cannot link an issue to itself`);
                    continue;
                }
                try {
                    await loadLinks(outward);
                    const forward = pairKey(outward, inward);
                    const reverse = pairKey(inward, outward);
                    if (existing.has(forward)) {
                        skipped.push(`${says(outward, inward)} (already linked)`);
                        continue;
                    }
                    if (existing.has(reverse)) {
                        if (symmetric) {
                            // Same relation, recorded in the other direction: nothing to do.
                            skipped.push(`${says(outward, inward)} (already linked as ${says(inward, outward)}; link type is symmetric)`);
                            continue;
                        }
                        if (!allowReciprocal) {
                            conflicts.push(`${says(outward, inward)}: opposite link already exists (${says(inward, outward)}). ` +
                                `Creating this link would make the issues "${matched.outward}" each other. ` +
                                `Remove the existing link first, or pass allowReciprocal: true if this is intended.`);
                            continue;
                        }
                    }
                    // The request body names the ends the other way round from the
                    // descriptions: `inwardIssue` is the issue the outward text is about
                    // (see linkRelationFor), so the blocker goes in `inwardIssue`.
                    await jira.issueLinks.linkIssues({
                        type: { name: matched.name },
                        inwardIssue: { key: outward },
                        outwardIssue: { key: inward }
                    });
                    existing.add(forward);
                    created.push(says(outward, inward));
                }
                catch (e) {
                    errors.push(`${says(outward, inward)}: ${e?.message ?? String(e)}`);
                }
            }
        }
        let msg = `Link type: "${matched.name}" (inward: "${matched.inward}", outward: "${matched.outward}", ${symmetric ? "symmetric" : "asymmetric"})\n`;
        const sections = [];
        if (created.length > 0)
            sections.push(`Created ${created.length} links:\n` + created.join("\n"));
        if (skipped.length > 0)
            sections.push(`Already existed, skipped ${skipped.length} links:\n` + skipped.join("\n"));
        if (conflicts.length > 0)
            sections.push(`Conflicting ${conflicts.length} links (not created):\n` + conflicts.join("\n"));
        if (errors.length > 0)
            sections.push(`Failed ${errors.length} links:\n` + errors.join("\n"));
        if (sections.length === 0)
            sections.push("No links created.");
        msg += sections.join("\n\n");
        const response = respond(msg);
        if ((errors.length > 0 || conflicts.length > 0) && created.length === 0 && skipped.length === 0) {
            response.isError = true;
        }
        return response;
    }, "Error linking issues");
}
