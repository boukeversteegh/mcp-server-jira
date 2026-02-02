import { listChildIssuesDefinition, listChildIssuesHandler } from "./tools/listChildIssues.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Version3Client } from "jira.js";
import { listJiraFiltersDefinition, listJiraFiltersHandler } from "./tools/listJiraFilters.js";
import { listUsersDefinition, listUsersHandler } from "./tools/listUsers.js";
import { searchIssuesDefinition, searchIssuesHandler } from "./tools/searchIssues.js";
import { listSprintTicketsDefinition, listSprintTicketsHandler } from "./tools/listSprintTickets.js";
import { getTicketDetailsDefinition, getTicketDetailsHandler } from "./tools/getTicketDetails.js";
import { addCommentDefinition, addCommentHandler } from "./tools/addComment.js";
import { updateDescriptionDefinition, updateDescriptionHandler } from "./tools/updateDescription.js";
import { createSubTicketDefinition, createSubTicketHandler } from "./tools/createSubTicket.js";
import { createTicketDefinition, createTicketHandler } from "./tools/createTicket.js";
import { updateIssuesDefinition, updateIssuesHandler } from "./tools/updateIssue.js";
import { listIssueFieldsDefinition, listIssueFieldsHandler } from "./tools/listIssueFields.js";
import { transitionIssuesDefinition, transitionIssuesHandler } from "./tools/transitionIssues.js";
import { listIssueTransitionsDefinition, listIssueTransitionsHandler } from "./tools/listIssueTransitions.js";
import { assignIssueDefinition, assignIssueHandler } from "./tools/assignIssue.js";
import { addLabelsDefinition, addLabelsHandler } from "./tools/addLabels.js";
import { linkIssuesDefinition, linkIssuesHandler } from "./tools/linkTickets.js";

// Map to store custom field information (name to ID mapping)
const customFieldsMap = new Map<string, string>();

const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error("Missing required environment variables. Required: JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN");
  process.exit(1);
}

const jira = new Version3Client({
  host: JIRA_HOST,
  authentication: {
    basic: {
      email: JIRA_EMAIL,
      apiToken: JIRA_API_TOKEN
    }
  }
});

// Initialize custom fields mapping
async function initializeCustomFields() {
  try {
    // Fetch all fields from Jira
    const fieldsResponse = await jira.issueFields.getFields();
    
    // First, map all custom fields automatically
    const allCustomFields = fieldsResponse.filter(f => f.custom && f.name && f.id);
    for (const field of allCustomFields) {
      if (field.name && field.id) {
        customFieldsMap.set(field.name, field.id);
      }
    }
    console.error(`Mapped ${customFieldsMap.size} custom fields automatically`);
  } catch (error: any) {
    console.error(`Error initializing custom fields: ${error.message}`);
  }
}


const server = new Server(
  { name: "jira-server", version: "1.0.0" },
  { capabilities: { tools: {}, resources: {} } }
);



// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    searchIssuesDefinition,
    addLabelsDefinition,
    linkIssuesDefinition,
    listSprintTicketsDefinition,
    getTicketDetailsDefinition,
    addCommentDefinition,
    updateDescriptionDefinition,
    listChildIssuesDefinition,
    createSubTicketDefinition,
    createTicketDefinition,
    updateIssuesDefinition,
    listIssueFieldsDefinition,
    transitionIssuesDefinition,
    listIssueTransitionsDefinition,
    assignIssueDefinition,
    listJiraFiltersDefinition,
    listUsersDefinition
  ]
}));


// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "search-issues": {
      return await searchIssuesHandler(jira, args as {
        jql?: string;
        projectKey?: string;
        issueType?: string;
        statusCategory?: string;
        maxResults?: number;
        nextPageToken?: string;
      });
    }
    
    case "list-sprint-tickets": {
      return await listSprintTicketsHandler(jira, args as { projectKey: string });
    }

    case "get-ticket-details": {
      return await getTicketDetailsHandler(jira, customFieldsMap, args as { issueKey: string });
    }

    case "add-comment": {
      return await addCommentHandler(jira, args as { issueKey: string; comment: string; commentFormat?: "plain" | "wiki" | "markdown" | "adf" });
    }

    case "update-description": {
      return await updateDescriptionHandler(jira, args as { issueKey: string; description: string; descriptionFormat?: "plain" | "wiki" | "markdown" | "adf" });
    }

    case "list-child-issues": {
      return await listChildIssuesHandler(jira, args as { parentKey: string });
    }


    case "create-sub-ticket": {
      return await createSubTicketHandler(jira, args as { parentKey: string; summary: string; description?: string; descriptionFormat?: "plain" | "wiki" | "markdown" | "adf"; issueType?: string });
    }

    case "link-issues": {
      return await linkIssuesHandler(jira, args as { inwardIssueKeys: string[]; outwardIssueKeys: string[] });
    }

    case "create-ticket": {
      return await createTicketHandler(jira, customFieldsMap, args as {
        projectKey: string;
        summary: string;
        description?: string;
        descriptionFormat?: "plain" | "wiki" | "markdown" | "adf";
        issueType?: string;
        parentKey?: string;
        fields?: Record<string, any>;
      });
    }

    case "update-issues": {
      return await updateIssuesHandler(jira, customFieldsMap, args as { issueKeys: string[]; fields: Record<string, any> });
    }

    case "list-issue-fields": {
      return await listIssueFieldsHandler(jira, customFieldsMap, args as { includeCustomOnly?: boolean });
    }

    case "add-labels": {
      return await addLabelsHandler(jira, args as { issueKeys: string[]; labels: string[] });
    }

    case "transition-issues": {
      return await transitionIssuesHandler(jira, args as { issueKeys: string[]; transitionId: string });
    }

    case "list-issue-transitions": {
      return await listIssueTransitionsHandler(jira, args as { issueKey: string });
    }

    case "assign-issue": {
      return await assignIssueHandler(jira, args as { issueKeys: string[]; assigneeDisplayName: string });
    }

    case "list-users": {
      return await listUsersHandler(jira, args as { maxResults?: number });
    }

    case "list-jira-filters": {
      return await listJiraFiltersHandler(jira);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});


// Start server
(async () => {
  try {
    // Initialize custom fields mapping
    console.error('Initializing custom fields...');
    await initializeCustomFields();
    console.error(`Initialized ${customFieldsMap.size} custom fields`);
    
    // Start the server
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error: any) {
    console.error(`Error starting server: ${error.message}`);
    process.exit(1);
  }
})();
