import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
import { buildADF, withJiraError, respond } from "../utils.js";

export const updateDescriptionDefinition = {
  name: "update-description",
  description: "Update the description of a specific ticket",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      description: {
        type: "string",
        description: "Description text. Use literal newlines (JSON \\n) for line breaks, not escaped backslashes."
      },
      descriptionFormat: {
        type: "string",
        enum: ["plain", "wiki", "markdown", "adf"],
        description:
          "Format of the description text: 'plain' (default) for simple text, 'wiki' for Jira wiki markup (h2., {code}, *bold*, etc.), 'markdown' for Markdown (## headings, **bold**, ```code```), 'adf' for raw Atlassian Document Format JSON"
      }
    },
    required: ["issueKey", "description"]
  }
};

export async function updateDescriptionHandler(
  jira: Version3Client,
  args: { issueKey: string; description: string; descriptionFormat?: DescriptionFormat }
): Promise<McpResponse> {
  const { issueKey, description, descriptionFormat = "plain" } = args;

  return withJiraError(async () => {
    await jira.issues.editIssue({
      issueIdOrKey: issueKey,
      fields: {
        description: buildADF(description, descriptionFormat)
      }
    });

    return respond(`Successfully updated description of ${issueKey}`);
  }, `Error updating description of ${issueKey}`);
}