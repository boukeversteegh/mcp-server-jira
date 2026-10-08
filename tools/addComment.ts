import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
import { buildADF, withJiraError, respond, fail, resolveContent, FILE_PATH_HINT, EMBED_HINT } from "../utils.js";
import { planEmbeds, applyEmbeds, embedBaseDir, formatEmbedLines } from "../shared/embedAttachments.js";

export const addCommentDefinition = {
  name: "add-comment",
  description:
    "Add a comment to a specific ticket. Provide the text inline via `comment`, or point at a local file via `filePath` for long content prepared on disk. " + EMBED_HINT,
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      comment: {
        type: "string",
        description: "Comment text. DO NOT escape newlines as backslash-n — use real newline characters only. Omit when using filePath."
      },
      filePath: {
        type: "string",
        description: FILE_PATH_HINT + " Alternative to comment."
      },
      commentFormat: {
        type: "string",
        enum: ["plain", "wiki", "markdown", "adf"],
        description:
          "Format of the comment text: 'plain' (default for inline text) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON. When filePath is used this defaults to the format implied by the file extension."
      }
    },
    required: ["issueKey"],
  },
};

export async function addCommentHandler(
  jira: Version3Client,
  args: { issueKey: string; comment?: string; filePath?: string; commentFormat?: DescriptionFormat }
): Promise<McpResponse> {
  const { issueKey, comment, filePath, commentFormat } = args;

  return withJiraError(async () => {
    const content = await resolveContent({
      inline: comment,
      filePath,
      format: commentFormat,
      inlineArgName: "comment",
    });
    if ("error" in content) return respond(content.error);

    const adf = buildADF(content.text, content.format);
    const planned = await planEmbeds(jira, issueKey, adf, embedBaseDir(filePath));
    if ("error" in planned) return fail(planned.error);
    const embedded = await applyEmbeds(jira, issueKey, planned.plan);

    const result = await jira.issueComments.addComment({
      issueIdOrKey: issueKey,
      comment: adf as any,
    });

    return respond(
      `Successfully added comment to ${issueKey} (comment ID: ${result.id}) from ${content.source} (format: ${content.format}, ${content.text.length} characters)` +
      formatEmbedLines(embedded)
    );
  }, `Error adding comment to ${issueKey}`);
}
