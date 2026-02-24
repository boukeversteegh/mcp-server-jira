import { buildADF } from "../utils.js";
import { createSubTicketCore } from "./createSubTicket.js";
export const createTicketDefinition = {
    name: "create-ticket",
    description: "Create a new ticket (regular issue or sub-task) with optional custom fields",
    inputSchema: {
        type: "object",
        properties: {
            projectKey: { type: "string" },
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
                description: "The name of the issue type (e.g., 'Task', 'Bug', etc.)"
            },
            parentKey: {
                type: "string",
                description: "Optional parent issue key. If provided, creates a sub-task."
            },
            fields: {
                type: "object",
                description: "Optional object containing additional field names and their values. Can include both standard fields and custom fields. For user fields (like assignee), use objects with accountId: {\"accountId\": \"user-account-id\"}. For arrays of users, use [{\"accountId\": \"id1\"}, {\"accountId\": \"id2\"}]. For option fields, use {\"value\": \"option-name\"} or {\"id\": \"option-id\"}. Note: summary, description, project, issuetype, and parent fields are handled separately and should not be included in this fields object.",
                additionalProperties: true
            }
        },
        required: ["projectKey", "summary"]
    }
};
export async function createTicketHandler(jira, customFieldsMap, args) {
    const { projectKey, summary, description = "", descriptionFormat = "plain", issueType = "Task", parentKey, fields = {} } = args;
    try {
        // If parentKey is provided, reuse sub-ticket creation logic
        if (parentKey) {
            return await createSubTicketCore(jira, { parentKey, summary, description, descriptionFormat, issueType });
        }
        // Get available issue types for the project
        const createMeta = await jira.issues.getCreateIssueMeta({
            projectKeys: [projectKey],
            expand: "projects.issuetypes"
        });
        const project = createMeta.projects?.[0];
        if (!project) {
            throw new Error(`Project ${projectKey} not found`);
        }
        // Filter for non-subtask issue types
        const standardTypes = project.issuetypes?.filter((it) => !it.subtask) || [];
        const availableIssueTypes = standardTypes.map((it) => it.name);
        console.error(`Available issue types: ${availableIssueTypes.join(", ")}`);
        // Use the first available type if the requested one doesn't exist
        const finalIssueType = availableIssueTypes.includes(issueType) ? issueType : availableIssueTypes[0] || "Task";
        console.error(`Using issue type: ${finalIssueType}`);
        // Process additional fields similar to update-issue
        const processedFields = { ...fields };
        const fieldMappings = {}; // To track field name to ID mappings
        // Handle assignee conversion if provided by name
        if (processedFields.assignee &&
            typeof processedFields.assignee === "object" &&
            processedFields.assignee.name &&
            !processedFields.assignee.accountId) {
            const assigneeDisplayName = processedFields.assignee.name;
            console.error(`Attempting to resolve assignee by display name: "${assigneeDisplayName}" for create-ticket`);
            try {
                const usersFound = await jira.userSearch.findUsers({ query: assigneeDisplayName });
                if (!usersFound || usersFound.length === 0) {
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Error: Assignee lookup failed. No user found with display name "${assigneeDisplayName}".`
                            }
                        ],
                        isError: true,
                        _meta: {}
                    };
                }
                if (usersFound.length > 1) {
                    const matchingUsers = usersFound.map((u) => `${u.displayName} (AccountId: ${u.accountId})`).join("\n - ");
                    return {
                        content: [
                            {
                                type: "text",
                                text: `Error: Assignee lookup failed. Multiple users found with display name "${assigneeDisplayName}":\n - ${matchingUsers}\nPlease use accountId for assignee.`
                            }
                        ],
                        isError: true,
                        _meta: {}
                    };
                }
                const userToAssign = usersFound[0];
                if (!userToAssign.accountId) {
                    return {
                        content: [
                            { type: "text", text: `Error: Assignee lookup failed. User "${userToAssign.displayName}" does not have an accountId.` }
                        ],
                        isError: true,
                        _meta: {}
                    };
                }
                processedFields.assignee = { accountId: userToAssign.accountId }; // Replace with accountId object
                console.error(`Successfully resolved assignee "${assigneeDisplayName}" to accountId "${userToAssign.accountId}" for create-ticket`);
            }
            catch (userSearchError) {
                console.error(`Error during assignee lookup for "${assigneeDisplayName}" in create-ticket: ${userSearchError.message}`);
                return {
                    content: [{ type: "text", text: `Error during assignee lookup: ${userSearchError.message}` }],
                    isError: true,
                    _meta: {}
                };
            }
        }
        else if (processedFields.assignee &&
            typeof processedFields.assignee === "object" &&
            processedFields.assignee.name &&
            processedFields.assignee.accountId) {
            // If both name and accountId are provided for assignee, prefer accountId and remove name.
            console.warn(`Assignee provided with both name and accountId in create-ticket. Using accountId: "${processedFields.assignee.accountId}" and removing name field.`);
            delete processedFields.assignee.name;
        }
        // Map custom field names to IDs for all fields in processedFields
        const additionalJiraFields = {};
        for (const [key, value] of Object.entries(processedFields)) {
            // Skip core fields that are handled separately
            if (["summary", "description", "project", "issuetype", "parent"].includes(key)) {
                console.warn(`Skipping field "${key}" in create-ticket as it's handled separately`);
                continue;
            }
            if (customFieldsMap.has(key)) {
                const fieldId = customFieldsMap.get(key);
                additionalJiraFields[fieldId] = value;
                fieldMappings[key] = fieldId;
                console.error(`Mapped field name "${key}" to ID "${fieldId}" in create-ticket`);
            }
            else {
                additionalJiraFields[key] = value; // Use key directly if not a custom field name or already an ID
                fieldMappings[key] = key;
                console.error(`Using field key directly: "${key}" in create-ticket`);
            }
        }
        // Create the issue payload with core fields and additional fields
        const issueFields = {
            summary: summary,
            project: {
                key: projectKey
            },
            issuetype: {
                name: finalIssueType
            },
            ...additionalJiraFields
        };
        if (description) {
            issueFields.description = buildADF(description, descriptionFormat);
        }
        const createIssuePayload = { fields: issueFields };
        console.error(`Create issue payload: ${JSON.stringify(createIssuePayload)}`);
        const created = await jira.issues.createIssue(createIssuePayload);
        // Format the field mappings for the response
        const fieldTexts = Object.entries(fieldMappings).map(([name, id]) => {
            return name === id ? name : `${name} (${id})`;
        });
        const additionalFieldsText = fieldTexts.length > 0 ? ` with additional fields: ${fieldTexts.join(", ")}` : "";
        const { key, self } = created;
        const urlText = self ? `\nURL: ${self.replace(/\/rest\/api\/3\/issue\/\w+$/, `/browse/${key}`)}` : "";
        return {
            content: [
                {
                    type: "text",
                    text: `Created ${key} in project ${projectKey}${additionalFieldsText}${urlText}`
                }
            ],
            _meta: {}
        };
    }
    catch (error) {
        console.error(`Error creating ticket: ${error.message}`);
        if (error.response) {
            console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        // Prepare a detailed error message
        let errorDetails = `Error creating ticket: ${error.message}`;
        if (error.response && error.response.data) {
            const responseData = typeof error.response.data === "object"
                ? JSON.stringify(error.response.data, null, 2)
                : error.response.data.toString();
            errorDetails += `\n\nResponse data:\n${responseData}`;
        }
        return {
            content: [{ type: "text", text: errorDetails }],
            isError: true,
            _meta: {}
        };
    }
}
