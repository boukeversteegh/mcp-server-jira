import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
import { buildADF, withJiraError, respond } from "../utils.js";

export const addCommentDefinition = {
  name: "add-comment",
  description: "Add a comment to a specific ticket",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      comment: { type: "string" },
      commentFormat: {
        type: "string",
        enum: ["plain", "wiki", "markdown", "adf"],
        description:
          "Format of the comment text: 'plain' (default) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON"
      }
    },
    required: ["issueKey", "comment"],
  },
};

export async function addCommentHandler(
  jira: Version3Client,
  args: { issueKey: string; comment: string; commentFormat?: DescriptionFormat }
): Promise<McpResponse> {
  const { issueKey, comment, commentFormat = "plain" } = args;

  return withJiraError(async () => {
    await jira.issueComments.addComment({
      issueIdOrKey: issueKey,
      comment: buildADF(comment, commentFormat) as any,
    });

    return respond(`Successfully added comment to ${issueKey}`);
  }, `Error adding comment to ${issueKey}`);
}