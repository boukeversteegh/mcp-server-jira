import { extractTextFromADF, formatFieldValue, hasMeaningfulValue } from "../shared/helpers.js";
export const getTicketDetailsDefinition = {
    name: "get-ticket-details",
    description: "Get detailed information about a specific ticket",
    inputSchema: {
        type: "object",
        properties: {
            issueKey: { type: "string" },
        },
        required: ["issueKey"],
    },
};
export async function getTicketDetailsHandler(jira, customFieldsMap, args) {
    const { issueKey } = args;
    const standardFields = [
        "summary",
        "status",
        "assignee",
        "description",
        "created",
        "updated",
        "issuelinks",
        "comment",
        "parent",
        "issuetype",
        "subtasks",
        "labels",
    ];
    const fieldsToFetch = [...standardFields, ...Array.from(customFieldsMap.values())];
    const issue = await jira.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: fieldsToFetch,
    });
    const baseHost = (process.env.JIRA_HOST || "").replace(/\/+$/, "");
    const url = baseHost ? `${baseHost}/browse/${issue.key}` : (issue.self || "");
    const description = extractTextFromADF(issue.fields.description);
    const linkedIssues = (issue.fields.issuelinks || [])
        .map((link) => {
        const relatedIssue = link.inwardIssue || link.outwardIssue;
        if (!relatedIssue)
            return null;
        return `${relatedIssue.key} ${relatedIssue.fields?.summary || "No summary"} [${relatedIssue.fields?.issuetype?.name || "Unknown type"}, ${relatedIssue.fields?.status?.name || "Unknown status"}]`;
    })
        .filter(Boolean)
        .join("\n");
    const subtasks = (issue.fields.subtasks || [])
        .map((subtask) => `${subtask.key} ${subtask.fields?.summary || "No summary"} [${subtask.fields?.issuetype?.name || "Unknown type"}, ${subtask.fields?.status?.name || "Unknown status"}]`)
        .join("\n");
    const relatedIssues = [linkedIssues || "No linked issues", subtasks || "No sub-tasks"]
        .filter((section) => section)
        .join("\n\n");
    const comments = issue.fields.comment?.comments || [];
    const formattedComments = comments.length > 0
        ? comments
            .map((comment) => {
            const created = comment.created ? new Date(comment.created).toLocaleString() : "Unknown date";
            const author = comment.author?.displayName || "Unknown user";
            let body = "";
            if (typeof comment.body === "string") {
                body = comment.body;
            }
            else if (comment.body && typeof comment.body === "object") {
                body = extractTextFromADF(comment.body);
            }
            else {
                body = "No content";
            }
            return `[${created}] ${author}:\n${body}`;
        })
            .join("\n\n")
        : "No comments";
    const customFieldsData = {};
    for (const [fieldName, fieldId] of customFieldsMap.entries()) {
        const raw = issue.fields[fieldId];
        if (hasMeaningfulValue(raw)) {
            customFieldsData[fieldName] = formatFieldValue(raw);
        }
    }
    const customFieldsSection = Object.keys(customFieldsData).length > 0
        ? `Custom Fields:
${Object.entries(customFieldsData)
            .map(([name, value]) => `${name}: ${value}`)
            .join("\n")}`
        : "";
    return {
        content: [
            {
                type: "text",
                text: `
Key: ${issue.key}
URL: ${url}
Title: ${issue.fields.summary || "No summary"}
Type: ${issue.fields.issuetype?.name || "Unknown type"}
Status: ${issue.fields.status?.name || "No status"}
Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}
Labels: ${Array.isArray(issue.fields.labels) && issue.fields.labels.length > 0
                    ? issue.fields.labels.join(", ")
                    : "No labels"}
Parent: ${issue.fields.parent
                    ? `${issue.fields.parent.key} (${issue.fields.parent.fields?.issuetype?.name || "Unknown type"}) - ${issue.fields.parent.fields?.summary || "No summary"}`
                    : "No parent"}
Description:
${description}
Related Issues:
${relatedIssues}
Created: ${issue.fields.created || "Unknown"}
Updated: ${issue.fields.updated || "Unknown"}

${customFieldsSection}

Comments:
${formattedComments}
`.trim(),
            },
        ],
        _meta: {},
    };
}
