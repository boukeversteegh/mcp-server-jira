import { buildADF, withJiraError, respond, fail, resolveContent, FILE_PATH_HINT, EMBED_HINT } from "../utils.js";
import { planEmbeds, applyEmbeds, embedBaseDir, formatEmbedLines } from "../shared/embedAttachments.js";
import { checkVersion, contentVersion, fetchContent } from "../shared/contentVersion.js";
export const updateDescriptionDefinition = {
    name: "update-description",
    description: "Update the description of a specific ticket. Provide the text inline via `description`, or point at a local file via `filePath` — the latter makes it easy to iterate on a long description by editing the file and re-sending. " + EMBED_HINT,
    inputSchema: {
        type: "object",
        properties: {
            issueKey: { type: "string" },
            description: {
                type: "string",
                description: "Description text. DO NOT escape newlines as backslash-n — use real newline characters only. Omit when using filePath."
            },
            filePath: {
                type: "string",
                description: FILE_PATH_HINT + " Alternative to description."
            },
            expectedVersion: {
                type: "string",
                description: "Content version the edit was based on, as reported by export-content and by get-ticket-details. Required whenever the description already has content (unless force is set): the update is refused if it changed in Jira since, so a concurrent edit is not silently overwritten. Omit it to write a description for the first time — that asserts the description is still empty, and is refused if one was written meanwhile."
            },
            force: {
                type: "boolean",
                description: "Skip the version check and overwrite whatever is in Jira. Defaults to false."
            },
            descriptionFormat: {
                type: "string",
                enum: ["plain", "wiki", "markdown", "adf"],
                description: "Format of the description text: 'plain' (default for inline text) for simple text, 'wiki' for Jira wiki markup (h2., {code}, *bold*, etc.), 'markdown' for Markdown (## headings, **bold**, ```code```), 'adf' for raw Atlassian Document Format JSON. When filePath is used this defaults to the format implied by the file extension."
            }
        },
        required: ["issueKey"]
    }
};
export async function updateDescriptionHandler(jira, args) {
    const { issueKey, description, filePath, descriptionFormat, expectedVersion, force } = args;
    return withJiraError(async () => {
        const content = await resolveContent({
            inline: description,
            filePath,
            format: descriptionFormat,
            inlineArgName: "description",
        });
        if ("error" in content)
            return respond(content.error);
        const conflict = await checkVersion({
            jira,
            issueKey,
            expectedVersion,
            force,
        });
        if (conflict)
            return respond(conflict);
        const adf = buildADF(content.text, content.format);
        const planned = await planEmbeds(jira, issueKey, adf, embedBaseDir(filePath));
        if ("error" in planned)
            return fail(planned.error);
        const embedded = await applyEmbeds(jira, issueKey, planned.plan);
        await jira.issues.editIssue({
            issueIdOrKey: issueKey,
            fields: {
                description: adf
            }
        });
        const newVersion = contentVersion((await fetchContent(jira, issueKey)).adf);
        return respond(`Successfully updated description of ${issueKey} from ${content.source} (format: ${content.format}, ${content.text.length} characters)\n` +
            `New version: ${newVersion} — pass this as expectedVersion for the next patch.` +
            formatEmbedLines(embedded));
    }, `Error updating description of ${issueKey}`);
}
