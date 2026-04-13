import { withJiraError, respond } from "../utils.js";
export const deleteCommentDefinition = {
    name: "delete-comment",
    description: "Delete a comment from a specific ticket",
    inputSchema: {
        type: "object",
        properties: {
            issueKey: { type: "string" },
            commentId: {
                type: "string",
                description: "The ID of the comment to delete"
            },
        },
        required: ["issueKey", "commentId"],
    },
};
export async function deleteCommentHandler(jira, args) {
    const { issueKey, commentId } = args;
    return withJiraError(async () => {
        await jira.issueComments.deleteComment({
            issueIdOrKey: issueKey,
            id: commentId,
        });
        return respond(`Successfully deleted comment ${commentId} from ${issueKey}`);
    }, `Error deleting comment ${commentId} from ${issueKey}`);
}
