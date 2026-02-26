import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
import { buildADF, withJiraError, respond } from "../utils.js";

export const updateCommentDefinition = {
  name: "update-comment",
  description: "Update an existing comment on a specific ticket",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      commentId: {
        type: "string",
        description: "The ID of the comment to update"
      },
      comment: {
        type: "string",
        description: "New comment text. Use literal newlines (JSON \\n) for line breaks, not escaped backslashes."
      },
      commentFormat: {
        type: "string",
        enum: ["plain", "wiki", "markdown", "adf"],
        description:
          "Format of the comment text: 'plain' (default) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON"
      }
    },
    required: ["issueKey", "commentId", "comment"],
  },
};

export async function updateCommentHandler(
  jira: Version3Client,
  args: { issueKey: string; commentId: string; comment: string; commentFormat?: DescriptionFormat }
): Promise<McpResponse> {
  const { issueKey, commentId, comment, commentFormat = "plain" } = args;

  return withJiraError(async () => {
    await jira.issueComments.updateComment({
      issueIdOrKey: issueKey,
      id: commentId,
      body: buildADF(comment, commentFormat) as any,
    });

    return respond(`Successfully updated comment ${commentId} on ${issueKey}`);
  }, `Error updating comment ${commentId} on ${issueKey}`);
}
