import { respond, withJiraError } from "../utils.js";
export const linkIssuesDefinition = {
    name: "link-issues",
    description: "Link multiple tickets using the 'relates to' relationship. Provide inwardIssueKeys and outwardIssueKeys lists to create links in both directions.",
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
            }
        },
        required: ["inwardIssueKeys", "outwardIssueKeys"]
    }
};
export async function linkIssuesHandler(jira, args) {
    const { inwardIssueKeys, outwardIssueKeys } = args;
    return withJiraError(async () => {
        if (!Array.isArray(inwardIssueKeys) || inwardIssueKeys.length === 0) {
            return respond("Error: inwardIssueKeys must be a non-empty array of issue keys.");
        }
        if (!Array.isArray(outwardIssueKeys) || outwardIssueKeys.length === 0) {
            return respond("Error: outwardIssueKeys must be a non-empty array of issue keys.");
        }
        const linkTypes = await jira.issueLinkTypes.getIssueLinkTypes();
        const relatesTo = linkTypes.issueLinkTypes?.find(linkType => linkType.name?.toLowerCase() === "relates to" ||
            linkType.inward?.toLowerCase() === "relates to" ||
            linkType.outward?.toLowerCase() === "relates to");
        if (!relatesTo) {
            throw new Error("Could not find 'relates to' link type");
        }
        const results = [];
        const errors = [];
        // Create cross-product links: every outward -> every inward (outwardIssue, inwardIssue)
        for (const outward of outwardIssueKeys) {
            for (const inward of inwardIssueKeys) {
                try {
                    await jira.issueLinks.linkIssues({
                        type: { name: relatesTo.name || "Relates" },
                        inwardIssue: { key: inward },
                        outwardIssue: { key: outward }
                    });
                    results.push(`${outward} -> ${inward}`);
                }
                catch (e) {
                    errors.push(`${outward} -> ${inward}: ${e?.message ?? String(e)}`);
                }
            }
        }
        let msg = `Link type: "${relatesTo.name || "Relates"}"\n`;
        if (results.length > 0) {
            msg += `Created ${results.length} links:\n` + results.join("\n");
        }
        if (errors.length > 0) {
            if (results.length > 0)
                msg += "\n\n";
            msg += `Failed ${errors.length} links:\n` + errors.join("\n");
        }
        return respond(msg || "No links created.");
    }, "Error linking issues");
}
