export const listUsersDefinition = {
    name: "list-users",
    description: "List all users in Jira with their account ID, email, and display name",
    inputSchema: {
        type: "object",
        properties: {
            maxResults: {
                type: "number",
                description: "Optional maximum number of results to return (default: 50, max: 1000)",
            },
        },
    },
};
export async function listUsersHandler(jira, args = {}) {
    const { maxResults = 50 } = args;
    const validatedMaxResults = Math.min(Math.max(1, maxResults), 1000);
    try {
        const usersResponse = await jira.users.getAllUsers({
            maxResults: validatedMaxResults,
        });
        if (!usersResponse || usersResponse.length === 0) {
            return { content: [{ type: "text", text: "No users found." }], _meta: {} };
        }
        const filteredUsers = usersResponse.filter((user) => {
            return user.active && user.accountType === "atlassian";
        });
        const formattedUsers = filteredUsers
            .map((user) => `Account ID: ${user.accountId}\nDisplay Name: ${user.displayName || "N/A"}\nEmail: ${user.emailAddress || "N/A"}`)
            .join("\n\n---\n\n");
        return {
            content: [
                {
                    type: "text",
                    text: `Active Atlassian users found: ${filteredUsers.length} (filtered from ${usersResponse.length} total)\n\n${formattedUsers}`,
                },
            ],
            _meta: {},
        };
    }
    catch (error) {
        console.error(`Error fetching users: ${error.message}`);
        return {
            content: [{ type: "text", text: `Error fetching users: ${error.message}` }],
            isError: true,
            _meta: {},
        };
    }
}
