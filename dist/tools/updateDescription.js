import { buildADF, withJiraError, respond, resolveContent, FILE_PATH_HINT } from "../utils.js";
export const updateDescriptionDefinition = {
    name: "update-description",
    description: "Update the description of a specific ticket. Provide the text inline via `description`, or point at a local file via `filePath` — the latter makes it easy to iterate on a long description by editing the file and re-sending.",
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
    const { issueKey, description, filePath, descriptionFormat } = args;
    return withJiraError(async () => {
        const content = await resolveContent({
            inline: description,
            filePath,
            format: descriptionFormat,
            inlineArgName: "description",
        });
        if ("error" in content)
            return respond(content.error);
        await jira.issues.editIssue({
            issueIdOrKey: issueKey,
            fields: {
                description: buildADF(content.text, content.format)
            }
        });
        return respond(`Successfully updated description of ${issueKey} from ${content.source} (format: ${content.format}, ${content.text.length} characters)`);
    }, `Error updating description of ${issueKey}`);
}
