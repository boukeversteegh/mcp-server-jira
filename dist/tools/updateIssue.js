export const updateIssuesDefinition = {
    name: "update-issues",
    description: 'Batch update fields on multiple tickets, including custom fields. For user fields (assignee, refiners, etc.), use {"accountId": "user-account-id"} format. For arrays of users, use [{"accountId": "id1"}, {"accountId": "id2"}]. Use the list-users tool to find account IDs.',
    inputSchema: {
        type: "object",
        properties: {
            issueKeys: {
                type: "array",
                items: { type: "string" }
            },
            fields: {
                type: "object",
                additionalProperties: true,
            },
        },
        required: ["issueKeys", "fields"],
    },
};
export async function updateIssuesHandler(jira, customFieldsMap, args) {
    const { issueKeys, fields } = args;
    try {
        if (fields.description !== undefined) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Error: The 'description' field cannot be updated using this method. Please use the 'update-description' method instead.",
                    },
                ],
                isError: true,
                _meta: {},
            };
        }
        if (!Array.isArray(issueKeys) || issueKeys.length === 0) {
            return {
                content: [{ type: "text", text: "Error: issueKeys must be a non-empty array of issue keys." }],
                isError: true,
                _meta: {},
            };
        }
        console.error(`Current customFieldsMap: ${JSON.stringify(Array.from(customFieldsMap.entries()))}`);
        const processedFields = { ...fields };
        const fieldMappings = {};
        // Resolve assignee by display name if provided as { assignee: { name: "John Doe" } }
        if (processedFields.assignee &&
            typeof processedFields.assignee === "object" &&
            processedFields.assignee.name &&
            !processedFields.assignee.accountId) {
            const assigneeDisplayName = processedFields.assignee.name;
            console.error(`Attempting to resolve assignee by display name: "${assigneeDisplayName}" for update-issues`);
            try {
                const usersFound = await jira.userSearch.findUsers({ query: assigneeDisplayName });
                if (!usersFound || usersFound.length === 0) {
                    return {
                        content: [
                            { type: "text", text: `Error: Assignee lookup failed. No user found with display name "${assigneeDisplayName}".` },
                        ],
                        isError: true,
                        _meta: {},
                    };
                }
                if (usersFound.length > 1) {
                    const matchingUsers = usersFound
                        .map((u) => `${u.displayName} (AccountId: ${u.accountId})`)
                        .join("\n - ");
                    return {
                        content: [
                            { type: "text", text: `Error: Assignee lookup failed. Multiple users found with display name "${assigneeDisplayName}":\n - ${matchingUsers}\nPlease use accountId for assignee.` },
                        ],
                        isError: true,
                        _meta: {},
                    };
                }
                const userToAssign = usersFound[0];
                if (!userToAssign.accountId) {
                    return {
                        content: [
                            { type: "text", text: `Error: Assignee lookup failed. User "${userToAssign.displayName}" does not have an accountId.` },
                        ],
                        isError: true,
                        _meta: {},
                    };
                }
                processedFields.assignee = { accountId: userToAssign.accountId };
                console.error(`Successfully resolved assignee "${assigneeDisplayName}" to accountId "${userToAssign.accountId}" for update-issues`);
            }
            catch (userSearchError) {
                console.error(`Error during assignee lookup for "${assigneeDisplayName}" in update-issues: ${userSearchError.message}`);
                return {
                    content: [{ type: "text", text: `Error during assignee lookup: ${userSearchError.message}` }],
                    isError: true,
                    _meta: {},
                };
            }
        }
        else if (processedFields.assignee &&
            typeof processedFields.assignee === "object" &&
            processedFields.assignee.name &&
            processedFields.assignee.accountId) {
            console.warn(`Assignee provided with both name and accountId in update-issues. Using accountId: "${processedFields.assignee.accountId}" and removing name field.`);
            delete processedFields.assignee.name;
        }
        // Map field names to Jira IDs using customFieldsMap when possible
        const finalJiraFields = {};
        for (const [key, value] of Object.entries(processedFields)) {
            if (customFieldsMap.has(key)) {
                const fieldId = customFieldsMap.get(key);
                finalJiraFields[fieldId] = value;
                fieldMappings[key] = fieldId;
                console.error(`Mapped field name "${key}" to ID "${fieldId}" in update-issues`);
            }
            else {
                finalJiraFields[key] = value; // Pass through standard fields (e.g., assignee) and already-ID'ed custom fields
                fieldMappings[key] = key;
                console.error(`Using field key directly: "${key}" in update-issues`);
            }
        }
        const successes = [];
        const errors = [];
        for (const issueKey of issueKeys) {
            try {
                console.error(`Updating issue ${issueKey} with final fields: ${JSON.stringify(finalJiraFields)}`);
                await jira.issues.editIssue({
                    issueIdOrKey: issueKey,
                    fields: finalJiraFields,
                });
                successes.push(issueKey);
            }
            catch (e) {
                errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
            }
        }
        const fieldTexts = Object.entries(fieldMappings).map(([name, id]) => (name === id ? name : `${name} (${id})`));
        const fieldsText = fieldTexts.length > 0 ? fieldTexts.join(", ") : "No fields were updated";
        let msg = `Fields in request: ${fieldsText}\n`;
        msg += `Updated ${successes.length} of ${issueKeys.length} issues.`;
        if (successes.length)
            msg += `\nSucceeded: ${successes.join(", ")}`;
        if (errors.length)
            msg += `\n\nFailed ${errors.length} issues:\n${errors.join("\n")}`;
        return {
            content: [{ type: "text", text: msg }],
            _meta: {},
        };
    }
    catch (error) {
        console.error(`Error updating issue: ${error.message}`);
        if (error.response) {
            console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        let errorDetails = `Error updating issue: ${error.message}`;
        if (error.response && error.response.data) {
            const responseData = typeof error.response.data === "object"
                ? JSON.stringify(error.response.data, null, 2)
                : error.response.data.toString();
            errorDetails += `\n\nResponse data:\n${responseData}`;
        }
        return {
            content: [{ type: "text", text: errorDetails }],
            isError: true,
            _meta: {},
        };
    }
}
