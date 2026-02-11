export const listJiraFiltersDefinition = {
    name: "list-jira-filters",
    description: "List all Jira filters.",
    inputSchema: {
        type: "object",
        properties: {} // No input parameters for now
    }
};
export async function listJiraFiltersHandler(jira) {
    try {
        let allFilters = [];
        let startAt = 0;
        let isLast = false;
        const maxResults = 50; // Jira's typical page size
        while (!isLast) {
            const filtersResponse = await jira.filters.getFiltersPaginated({
                expand: "jql",
                startAt,
                maxResults,
            });
            if (filtersResponse.values && filtersResponse.values.length > 0) {
                allFilters = allFilters.concat(filtersResponse.values);
            }
            isLast = filtersResponse.isLast ?? true;
            if (!isLast) {
                startAt += filtersResponse.values?.length || maxResults;
            }
            if (!filtersResponse.values || filtersResponse.values.length < maxResults) {
                isLast = true;
            }
        }
        if (allFilters.length === 0) {
            return { content: [{ type: "text", text: "No filters found." }], _meta: {} };
        }
        const formattedFilters = allFilters
            .map((filter) => `ID: ${filter.id}\nName: ${filter.name}\nJQL: ${filter.jql || "JQL not available"}\nView URL: ${filter.viewUrl}`)
            .join("\n\n---\n\n");
        return {
            content: [{ type: "text", text: `Total filters found: ${allFilters.length}\n\n${formattedFilters}` }],
            _meta: {},
        };
    }
    catch (error) {
        console.error(`Error fetching Jira filters: ${error.message}`, error);
        return {
            content: [{ type: "text", text: `Error fetching Jira filters: ${error.message}` }],
            isError: true,
            _meta: {},
        };
    }
}
