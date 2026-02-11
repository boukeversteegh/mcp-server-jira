import { respond, validateArray, validateString, withJiraError } from "../utils.js";
export const assignIssueDefinition = {
    name: "assign-issue",
    description: "Assign an issue to a user by their display name.",
    inputSchema: {
        type: "object",
        properties: {
            issueKeys: {
                type: "array",
                items: { type: "string" },
                description: "List of issue keys to assign (e.g., ['EDU-123', 'EDU-124']).",
            },
            assigneeDisplayName: {
                type: "string",
                description: "The display name of the user to assign the issues to (e.g., 'John Doe').",
            },
        },
        required: ["issueKeys", "assigneeDisplayName"],
    },
};
export async function assignIssueHandler(jira, args) {
    const { issueKeys, assigneeDisplayName } = args;
    const issuesErr = validateArray("issueKeys", issueKeys);
    if (issuesErr)
        return respond(issuesErr.replace("array", "array of issue keys"));
    const nameErr = validateString("assigneeDisplayName", assigneeDisplayName);
    if (nameErr)
        return respond(nameErr);
    return withJiraError(async () => {
        const usersFound = await jira.userSearch.findUsers({ query: assigneeDisplayName });
        if (!usersFound || usersFound.length === 0) {
            return respond(`Error: No user found with display name "${assigneeDisplayName}".`);
        }
        if (usersFound.length > 1) {
            const matching = usersFound.map((u) => `${u.displayName} (AccountId: ${u.accountId})`).join("\n - ");
            return respond(`Error: Multiple users found with display name "${assigneeDisplayName}":\n - ${matching}\nPlease be more specific or use the accountId.`);
        }
        const user = usersFound[0];
        if (!user.accountId) {
            return respond(`Error: User "${user.displayName}" does not have an accountId.`);
        }
        const results = [];
        const errors = [];
        for (const issueKey of issueKeys) {
            try {
                await jira.issues.assignIssue({ issueIdOrKey: issueKey, accountId: user.accountId });
                results.push(`${issueKey}: assigned to ${user.displayName}`);
            }
            catch (e) {
                errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
            }
        }
        let msg = "";
        if (results.length > 0) {
            msg += `Assigned ${results.length} of ${issueKeys.length} issues to ${user.displayName}:\n` + results.join("\n");
        }
        if (errors.length > 0) {
            if (msg)
                msg += "\n\n";
            msg += `Failed to assign ${errors.length} issues:\n` + errors.join("\n");
        }
        const response = respond(msg || "No issues processed.");
        if (errors.length === issueKeys.length)
            response.isError = true;
        return response;
    }, `Error during assignment process for display name "${assigneeDisplayName}"`);
}
