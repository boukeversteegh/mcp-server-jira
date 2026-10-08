import { buildADF, resolveContent, respond, fail, FILE_PATH_HINT, EMBED_HINT } from "../utils.js";
import { planEmbeds, embedBaseDir, formatEmbedLines, writeDeferredDescription } from "../shared/embedAttachments.js";
export const createSubTicketDefinition = {
    name: "create-sub-ticket",
    description: "Create a sub-ticket (child issue) for a parent ticket. The description can be given inline via `description` or read from a local file via `filePath`. " + EMBED_HINT,
    inputSchema: {
        type: "object",
        properties: {
            parentKey: { type: "string" },
            summary: { type: "string" },
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
                description: "Format of the description text: 'plain' (default for inline text) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON. When filePath is used this defaults to the format implied by the file extension."
            },
            issueType: {
                type: "string",
                description: "The name of the sub-task issue type (e.g., 'Sub-task')"
            }
        },
        required: ["parentKey", "summary"]
    }
};
export async function createSubTicketCore(jira, args) {
    const { parentKey, summary, description = "", descriptionFormat = "plain", issueType = "Sub-task", descriptionSource } = args;
    const descriptionAdf = description ? buildADF(description, descriptionFormat) : null;
    const planned = descriptionAdf
        ? await planEmbeds(jira, undefined, descriptionAdf, args.embedBaseDir ?? embedBaseDir(undefined))
        : null;
    if (planned && "error" in planned)
        return fail(planned.error);
    const deferDescription = !!planned && planned.plan.refs.length > 0;
    try {
        const parentIssue = await jira.issues.getIssue({
            issueIdOrKey: parentKey,
            fields: ["project", "issuetype"],
        });
        if (!parentIssue || !parentIssue.fields.project) {
            throw new Error(`Parent issue ${parentKey} not found or has no project`);
        }
        const createMeta = await jira.issues.getCreateIssueMeta({
            projectIds: [parentIssue.fields.project.id],
            expand: "projects.issuetypes",
        });
        const subtaskTypes = createMeta.projects?.[0]?.issuetypes?.filter((it) => it.subtask) || [];
        const availableIssueTypes = subtaskTypes.map((it) => it.name);
        const finalIssueType = availableIssueTypes.includes(issueType)
            ? issueType
            : availableIssueTypes[0] || "Sub-task";
        const createIssuePayload = {
            fields: {
                summary,
                parent: { key: parentKey },
                project: { id: parentIssue.fields.project.id },
                issuetype: { name: finalIssueType },
                ...(descriptionAdf && !deferDescription ? { description: descriptionAdf } : {}),
            },
        };
        const created = await jira.issues.createIssue(createIssuePayload);
        const { key, self } = created;
        const urlText = self ? `\nURL: ${self.replace(/\/rest\/api\/3\/issue\/\w+$/, `/browse/${key}`)}` : "";
        let embedText = "";
        if (deferDescription) {
            const written = await writeDeferredDescription(jira, key, descriptionAdf, planned.plan);
            if ("error" in written)
                return fail(written.error);
            embedText = formatEmbedLines(written.lines);
        }
        const sourceText = descriptionSource
            ? `\nDescription from ${descriptionSource} (format: ${descriptionFormat}, ${description.length} characters)`
            : "";
        return {
            content: [{ type: "text", text: `Created ${key} under ${parentKey}${urlText}${sourceText}${embedText}` }],
            _meta: {},
        };
    }
    catch (error) {
        let errorDetails = `Error creating sub-ticket: ${error.message}`;
        if (error.response && error.response.data) {
            const responseData = typeof error.response.data === "object"
                ? JSON.stringify(error.response.data, null, 2)
                : error.response.data.toString();
            errorDetails += `\n\nResponse data:\n${responseData}`;
        }
        return { content: [{ type: "text", text: errorDetails }], isError: true, _meta: {} };
    }
}
export async function createSubTicketHandler(jira, args) {
    const { filePath, description, descriptionFormat, ...rest } = args;
    const content = await resolveContent({
        inline: description,
        filePath,
        format: descriptionFormat,
        inlineArgName: "description",
        optional: true,
    });
    if ("error" in content)
        return respond(content.error);
    return createSubTicketCore(jira, {
        ...rest,
        description: content.text,
        descriptionFormat: content.format,
        descriptionSource: content.source || undefined,
        embedBaseDir: embedBaseDir(filePath),
    });
}
