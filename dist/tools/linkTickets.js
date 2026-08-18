import { respond, withJiraError } from "../utils.js";
export const linkIssuesDefinition = {
    name: "link-issues",
    description: "Link multiple tickets using a specified link type. Provide inwardIssueKeys and outwardIssueKeys lists to create links in both directions. Existing links are detected and never duplicated: the result reports which links were created and which were already present. For asymmetric link types (e.g. 'Blocks'), an existing link in the opposite direction is reported as a conflict instead of being created (override with allowReciprocal).",
    inputSchema: {
        type: "object",
        properties: {
            inwardIssueKeys: {
                type: "array",
                items: { type: "string" },
                description: "Keys that will be used as inwardIssue in links"
            },
            outwardIssueKeys: {
                type: "array",
                items: { type: "string" },
                description: "Keys that will be used as outwardIssue in links"
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
/** Directed pair key: outwardIssue -> inwardIssue */
const pairKey = (outward, inward) => `${norm(outward)}=>${norm(inward)}`;
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
        const needle = linkType.toLowerCase();
        // Strip leading numeric prefix (e.g. "1. Relates" -> "relates") for flexible matching
        const stripPrefix = (s) => s.replace(/^\d+\.\s*/, "").toLowerCase();
        const matched = available.find((lt) => lt.name?.toLowerCase() === needle ||
            stripPrefix(lt.name ?? "") === needle ||
            lt.inward?.toLowerCase() === needle ||
            lt.outward?.toLowerCase() === needle);
        if (!matched) {
            const list = available
                .map((lt) => `  - "${lt.name}" (inward: "${lt.inward}", outward: "${lt.outward}")`)
                .join("\n");
            return respond(`Link type "${linkType}" not found. Use the exact name shown in quotes below as the linkType value:\n${list}`);
        }
        // Symmetry is derived from Jira's own definition of the link type: a type whose
        // inward and outward descriptions are identical (e.g. "relates to"/"relates to")
        // describes the same relation in both directions, so A->B and B->A are one link.
        const symmetric = (matched.inward ?? "").trim().toLowerCase() === (matched.outward ?? "").trim().toLowerCase();
        const sameType = (t) => t?.id && matched.id ? t.id === matched.id : (t?.name ?? "").toLowerCase() === (matched.name ?? "").toLowerCase();
        // Directed pairs (outwardIssue => inwardIssue) of this link type that already exist,
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
                // Jira returns only the *other* end of the link, under the field naming that
                // issue's role. So `inwardIssue: Y` on issue X means the link is
                // (outwardIssue: X, inwardIssue: Y), and `outwardIssue: Y` means (Y, X).
                if (link.inwardIssue?.key)
                    existing.add(pairKey(self, link.inwardIssue.key));
                if (link.outwardIssue?.key)
                    existing.add(pairKey(link.outwardIssue.key, self));
            }
            loaded.add(norm(issueKey));
            loaded.add(norm(self));
        };
        const created = [];
        const skipped = [];
        const conflicts = [];
        const errors = [];
        // Create cross-product links: every outward -> every inward (outwardIssue, inwardIssue)
        for (const outward of outwardIssueKeys) {
            for (const inward of inwardIssueKeys) {
                if (norm(outward) === norm(inward)) {
                    errors.push(`${outward} -> ${inward}: cannot link an issue to itself`);
                    continue;
                }
                try {
                    await loadLinks(outward);
                    const forward = pairKey(outward, inward);
                    const reverse = pairKey(inward, outward);
                    if (existing.has(forward)) {
                        skipped.push(`${outward} -> ${inward} (already linked)`);
                        continue;
                    }
                    if (existing.has(reverse)) {
                        if (symmetric) {
                            // Same relation, recorded in the other direction: nothing to do.
                            skipped.push(`${outward} -> ${inward} (already linked as ${inward} -> ${outward}; link type is symmetric)`);
                            continue;
                        }
                        if (!allowReciprocal) {
                            conflicts.push(`${outward} -> ${inward}: opposite link already exists (${inward} "${matched.outward}" ${outward}). ` +
                                `Creating this link would make the issues "${matched.outward}" each other. ` +
                                `Remove the existing link first, or pass allowReciprocal: true if this is intended.`);
                            continue;
                        }
                    }
                    await jira.issueLinks.linkIssues({
                        type: { name: matched.name },
                        inwardIssue: { key: inward },
                        outwardIssue: { key: outward }
                    });
                    existing.add(forward);
                    created.push(`${outward} -> ${inward}`);
                }
                catch (e) {
                    errors.push(`${outward} -> ${inward}: ${e?.message ?? String(e)}`);
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
