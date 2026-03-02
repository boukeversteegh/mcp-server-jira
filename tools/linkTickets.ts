import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, withJiraError } from "../utils.js";

export const linkIssuesDefinition = {
    name: "link-issues",
    description: "Link multiple tickets using a specified link type. Provide inwardIssueKeys and outwardIssueKeys lists to create links in both directions.",
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
            }
        },
        required: ["inwardIssueKeys", "outwardIssueKeys"]
    }
};

export async function linkIssuesHandler(
    jira: Version3Client,
    args: { inwardIssueKeys: string[]; outwardIssueKeys: string[]; linkType?: string }
): Promise<McpResponse> {
    const { inwardIssueKeys, outwardIssueKeys, linkType = "Relates" } = args;

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
        const matched = available.find(
            (lt) =>
                lt.name?.toLowerCase() === needle ||
                lt.inward?.toLowerCase() === needle ||
                lt.outward?.toLowerCase() === needle
        );

        if (!matched) {
            const list = available
                .map((lt) => `  - ${lt.name} (inward: "${lt.inward}", outward: "${lt.outward}")`)
                .join("\n");
            return respond(`Link type "${linkType}" not found. Available types:\n${list}`);
        }
 
        const results: string[] = [];
        const errors: string[] = [];
 
        // Create cross-product links: every outward -> every inward (outwardIssue, inwardIssue)
        for (const outward of outwardIssueKeys) {
            for (const inward of inwardIssueKeys) {
                try {
                    await jira.issueLinks.linkIssues({
                        type: { name: matched.name! },
                        inwardIssue: { key: inward },
                        outwardIssue: { key: outward }
                    });
                    results.push(`${outward} -> ${inward}`);
                } catch (e: any) {
                    errors.push(`${outward} -> ${inward}: ${e?.message ?? String(e)}`);
                }
            }
        }

        let msg = `Link type: "${matched.name}" (inward: "${matched.inward}", outward: "${matched.outward}")\n`;
        if (results.length > 0) {
            msg += `Created ${results.length} links:\n` + results.join("\n");
        }
        if (errors.length > 0) {
            if (results.length > 0) msg += "\n\n";
            msg += `Failed ${errors.length} links:\n` + errors.join("\n");
        }
        return respond(msg || "No links created.");
    }, "Error linking issues");
}