export const listIssueTransitionsDefinition = {
    name: "list-issue-transitions",
    description: "List available transitions for a specific issue.",
    inputSchema: {
        type: "object",
        properties: {
            issueKey: { type: "string" },
        },
        required: ["issueKey"],
    },
};
export async function listIssueTransitionsHandler(jira, args) {
    const { issueKey } = args;
    if (!issueKey || typeof issueKey !== "string") {
        return {
            content: [{ type: "text", text: "Error: issueKey must be a non-empty string" }],
            isError: true,
            _meta: {},
        };
    }
    try {
        const transitionsResponse = await jira.issues.getTransitions({ issueIdOrKey: issueKey });
        const availableTransitions = transitionsResponse.transitions?.map((t) => ({
            id: t.id,
            name: t.name,
            toStatus: t.to?.name,
            toStatusCategory: t.to?.statusCategory?.name,
        })) ?? [];
        if (availableTransitions.length === 0) {
            return {
                content: [{ type: "text", text: `No available transitions found for issue ${issueKey}.` }],
                _meta: {},
            };
        }
        const formattedTransitions = availableTransitions
            .map((t) => `ID: ${t.id}, Name: "${t.name}" (To Status: ${t.toStatus || "N/A"} - ${t.toStatusCategory || "N/A"})`)
            .join("\n");
        return {
            content: [{ type: "text", text: `Available transitions for ${issueKey}:\n${formattedTransitions}` }],
            _meta: {},
        };
    }
    catch (error) {
        console.error(`Error listing transitions for issue ${issueKey}: ${error.message}`);
        if (error.response) {
            console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        return {
            content: [{ type: "text", text: `Error listing transitions for ${issueKey}: ${error.message}` }],
            isError: true,
            _meta: {},
        };
    }
}
