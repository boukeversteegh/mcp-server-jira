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
                description: "New comment text. DO NOT escape newlines as backslash-n — use real newline characters only."
            },
            commentFormat: {
                type: "string",
                enum: ["plain", "wiki", "markdown", "adf"],
                description: "Format of the comment text: 'plain' (default) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON"
            }
        },
        required: ["issueKey", "commentId", "comment"],
    },
};
export async function updateCommentHandler(jira, args) {
    const { issueKey, commentId, comment, commentFormat = "plain" } = args;
    return withJiraError(async () => {
        await jira.issueComments.updateComment({
            issueIdOrKey: issueKey,
            id: commentId,
            body: buildADF(comment, commentFormat),
        });
        return respond(`Successfully updated comment ${commentId} on ${issueKey}`);
    }, `Error updating comment ${commentId} on ${issueKey}`);
}
