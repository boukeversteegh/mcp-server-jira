import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, validateArray, withJiraError } from "../utils.js";

export const unlinkIssuesDefinition = {
  name: "unlink-issues",
  description: "Remove links between issues. Removes all 'relates to' links between the specified issue sets.",
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
        description: "Link type name to filter (e.g., 'Relates', 'Blocks'). If omitted, removes all link types."
      }
    },
    required: ["issueKeys"]
  }
};

export async function unlinkIssuesHandler(
  jira: Version3Client,
  args: { issueKeys: string[]; targetKeys?: string[]; linkType?: string }
): Promise<McpResponse> {
  const { issueKeys, targetKeys, linkType } = args;

  const issuesErr = validateArray("issueKeys", issueKeys);
  if (issuesErr) return respond(issuesErr.replace("array", "array of issue keys"));

  const targetSet = targetKeys ? new Set(targetKeys) : null;

  return withJiraError(async () => {
    const results: string[] = [];
    const errors: string[] = [];

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
          if (linkType && link.type?.name?.toLowerCase() !== linkType.toLowerCase()) continue;

          // Get the linked issue key (could be inward or outward)
          const linkedKey = link.inwardIssue?.key || link.outwardIssue?.key;
          if (!linkedKey) continue;

          // If targetKeys specified, only remove links to those targets
          if (targetSet && !targetSet.has(linkedKey)) continue;

          // Delete the link
          if (link.id) {
            try {
              await jira.issueLinks.deleteIssueLink({ linkId: link.id });
              results.push(`${issueKey} <-> ${linkedKey} [${link.type?.name}, id:${link.id}]`);
            } catch (e: any) {
              errors.push(`${issueKey} <-> ${linkedKey}: ${e?.message ?? String(e)}`);
            }
          }
        }
      } catch (e: any) {
        errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
      }
    }

    let msg = linkType ? `Link type filter: "${linkType}"\n` : "All link types\n";
    if (results.length > 0) {
      msg += `Removed ${results.length} links:\n` + results.join("\n");
    } else if (errors.length === 0) {
      msg += "No matching links found to remove.";
    }
    if (errors.length > 0) {
      if (results.length > 0) msg += "\n\n";
      msg += `Failed ${errors.length} operations:\n` + errors.join("\n");
    }

    const response = respond(msg);
    if (errors.length > 0 && results.length === 0) response.isError = true;
    return response;
  }, "Error unlinking issues");
}
