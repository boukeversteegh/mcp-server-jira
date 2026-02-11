export const searchIssuesDefinition = {
    name: "search-issues",
    description: "Search for issues with optional filters for project, issue type, and status category, or using a custom JQL query",
    inputSchema: {
        type: "object",
        properties: {
            jql: {
                type: "string",
                description: "Optional custom JQL query. If provided, other filter parameters will be ignored",
            },
            projectKey: {
                type: "string",
                description: "Optional project key to filter issues by project",
            },
            issueType: {
                type: "string",
                description: "Optional issue type to filter issues (e.g., 'Bug', 'Task', 'Story')",
            },
            statusCategory: {
                type: "string",
                description: "Optional status category to filter issues. Must be one of: 'To Do', 'In Progress', 'Done'",
            },
            maxResults: {
                type: "number",
                description: "Optional maximum number of results to return per page (default: 50, max: 100)",
            },
            nextPageToken: {
                type: "string",
                description: "Optional pagination token to fetch the next page of results. Use the token from the previous response.",
            },
        },
    },
};
export async function searchIssuesHandler(jira, args) {
    const { jql: customJql, projectKey, issueType, statusCategory, maxResults = 50, nextPageToken } = args || {};
    const validatedMaxResults = Math.min(Math.max(1, maxResults), 100);
    if (validatedMaxResults !== maxResults) {
        console.error(`Adjusted maxResults from ${maxResults} to ${validatedMaxResults} (valid range: 1-100)`);
    }
    let jql;
    if (customJql) {
        jql = customJql;
        console.error(`Using custom JQL query: ${jql}`);
    }
    else {
        const jqlParts = [];
        if (projectKey)
            jqlParts.push(`project = ${projectKey}`);
        if (issueType)
            jqlParts.push(`issuetype = "${issueType}"`);
        if (statusCategory) {
            const validStatusCategories = ["To Do", "In Progress", "Done"];
            if (!validStatusCategories.includes(statusCategory)) {
                return {
                    content: [{ type: "text", text: `Error: statusCategory must be one of: ${validStatusCategories.join(", ")}` }],
                    isError: true,
                    _meta: {},
                };
            }
            jqlParts.push(`statusCategory = "${statusCategory}"`);
        }
        jql = jqlParts.length > 0 ? `${jqlParts.join(" AND ")} ORDER BY updated DESC` : "ORDER BY updated DESC";
    }
    console.error(`Executing JQL query: ${jql}`);
    try {
        const searchParams = {
            jql,
            maxResults: validatedMaxResults,
            fields: ["summary", "status", "issuetype", "assignee", "updated", "statusCategory"],
        };
        if (nextPageToken) {
            searchParams.nextPageToken = nextPageToken;
        }
        const result = await jira.issueSearch.searchForIssuesUsingJqlEnhancedSearch(searchParams);
        const baseHost = (process.env.JIRA_HOST || "").replace(/\/+$/, "");
        const urlPattern = baseHost ? `${baseHost}/browse/{ISSUE_KEY}` : "{issue.self}";
        const formattedIssues = (result.issues || []).map((issue) => {
            const statusCat = issue.fields.status?.statusCategory?.name || "Unknown";
            const updated = issue.fields.updated ? new Date(issue.fields.updated).toLocaleString() : "Unknown";
            return `${issue.key}: ${issue.fields.summary || "No summary"} [${issue.fields.issuetype?.name || "Unknown type"}, ${issue.fields.status?.name || "No status"} (${statusCat}), Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}, Updated: ${updated}]`;
        });
        const resultsCount = formattedIssues.length;
        const paginationInfo = resultsCount > 0 ? `Found ${resultsCount} issue${resultsCount === 1 ? '' : 's'} on this page` : `No results found`;
        let navigationHints = "";
        if (result.nextPageToken) {
            navigationHints += `\n\nMore results available. To fetch the next page, use: nextPageToken="${result.nextPageToken}"`;
        }
        return {
            content: [
                {
                    type: "text",
                    text: formattedIssues.length > 0
                        ? `${paginationInfo}${navigationHints}\n\nURL pattern: ${urlPattern}\n\n${formattedIssues.join("\n")}`
                        : "No issues found matching the criteria",
                },
            ],
            _meta: {},
        };
    }
    catch (error) {
        console.error(`Error searching for issues: ${error.message}`);
        if (error.response) {
            console.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        return {
            content: [{ type: "text", text: `Error searching for issues: ${error.message}` }],
            isError: true,
            _meta: {},
        };
    }
}
