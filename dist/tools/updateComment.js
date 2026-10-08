import { buildADFWithReport, withJiraError, respond, resolveContent, FILE_PATH_HINT } from "../utils.js";
import { summarizeSmartLinks } from "../shared/smartLinks.js";
import { checkVersion, contentVersion, fetchContent } from "../shared/contentVersion.js";
export const updateCommentDefinition = {
    name: "update-comment",
    description: "Update an existing comment on a specific ticket. Provide the text inline via `comment`, or point at a local file via `filePath` — the latter makes it easy to iterate on a long comment by editing the file and re-sending.",
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
                description: "New comment text. DO NOT escape newlines as backslash-n — use real newline characters only. Omit when using filePath."
            },
            filePath: {
                type: "string",
                description: FILE_PATH_HINT + " Alternative to comment."
            },
            expectedVersion: {
                type: "string",
                description: "Content version the edit was based on, as reported by export-content and by get-ticket-details. Required (unless force is set): the update is refused if the comment changed in Jira since, so a concurrent edit is not silently overwritten."
            },
            force: {
                type: "boolean",
                description: "Skip the version check and overwrite whatever is in Jira. Defaults to false."
            },
            commentFormat: {
                type: "string",
                enum: ["plain", "wiki", "markdown", "adf"],
                description: "Format of the comment text: 'plain' (default for inline text) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON. When filePath is used this defaults to the format implied by the file extension."
            }
        },
        required: ["issueKey", "commentId"],
    },
};
export async function updateCommentHandler(jira, args) {
    const { issueKey, commentId, comment, filePath, commentFormat, expectedVersion, force } = args;
    return withJiraError(async () => {
        const content = await resolveContent({
            inline: comment,
            filePath,
            format: commentFormat,
            inlineArgName: "comment",
        });
        if ("error" in content)
            return respond(content.error);
        const conflict = await checkVersion({
            jira,
            issueKey,
            commentId,
            expectedVersion,
            force,
        });
        if (conflict)
            return respond(conflict);
        const { adf, smartLinks } = buildADFWithReport(content.text, content.format);
        await jira.issueComments.updateComment({
            issueIdOrKey: issueKey,
            id: commentId,
            body: adf,
        });
        const newVersion = contentVersion((await fetchContent(jira, issueKey, commentId)).adf);
        return respond(`Successfully updated comment ${commentId} on ${issueKey} from ${content.source} (format: ${content.format}, ${content.text.length} characters)\n` +
            `New version: ${newVersion} — pass this as expectedVersion for the next patch.` +
            summarizeSmartLinks(smartLinks));
    }, `Error updating comment ${commentId} on ${issueKey}`);
}
