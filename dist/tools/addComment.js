import { buildADFWithReport, withJiraError, respond, resolveContent, FILE_PATH_HINT } from "../utils.js";
import { summarizeSmartLinks } from "../shared/smartLinks.js";
export const addCommentDefinition = {
    name: "add-comment",
    description: "Add a comment to a specific ticket. Provide the text inline via `comment`, or point at a local file via `filePath` for long content prepared on disk.",
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
                description: "Format of the comment text: 'plain' (default for inline text) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON. When filePath is used this defaults to the format implied by the file extension."
            }
        },
        required: ["issueKey"],
    },
};
export async function addCommentHandler(jira, args) {
    const { issueKey, comment, filePath, commentFormat } = args;
    return withJiraError(async () => {
        const content = await resolveContent({
            inline: comment,
            filePath,
            format: commentFormat,
            inlineArgName: "comment",
        });
        if ("error" in content)
            return respond(content.error);
        const { adf, smartLinks } = buildADFWithReport(content.text, content.format);
        const result = await jira.issueComments.addComment({
            issueIdOrKey: issueKey,
            comment: adf,
        });
        return respond(`Successfully added comment to ${issueKey} (comment ID: ${result.id}) from ${content.source} (format: ${content.format}, ${content.text.length} characters)` +
            summarizeSmartLinks(smartLinks));
    }, `Error adding comment to ${issueKey}`);
}
