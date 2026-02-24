import { buildADF } from "../utils.js";
export const createSubTicketDefinition = {
    name: "create-sub-ticket",
    description: "Create a sub-ticket (child issue) for a parent ticket",
    inputSchema: {
        type: "object",
        properties: {
            parentKey: { type: "string" },
            summary: { type: "string" },
            description: {
                type: "string",
                description: "Description text. Use literal newlines (JSON \\n) for line breaks, not escaped backslashes."
            },
            descriptionFormat: {
                type: "string",
                enum: ["plain", "wiki", "markdown", "adf"],
                description: "Format of the description text: 'plain' (default) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON"
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
    const { parentKey, summary, description = "", descriptionFormat = "plain", issueType = "Sub-task" } = args;
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
                ...(description ? { description: buildADF(description, descriptionFormat) } : {}),
            },
        };
        const created = await jira.issues.createIssue(createIssuePayload);
        const { key, self } = created;
        const urlText = self ? `\nURL: ${self.replace(/\/rest\/api\/3\/issue\/\w+$/, `/browse/${key}`)}` : "";
        return {
            content: [{ type: "text", text: `Created ${key} under ${parentKey}${urlText}` }],
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
    return createSubTicketCore(jira, args);
}
