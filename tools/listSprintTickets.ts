import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

export const listSprintTicketsDefinition = {
  name: "list-sprint-tickets",
  description: "Get all tickets in the active sprint",
  inputSchema: {
    type: "object",
    properties: {
      projectKey: { type: "string" },
      includeOpen: {
        type: "boolean",
        description: "Include tickets from active/open sprints (default: true)",
      },
      includeFuture: {
        type: "boolean",
        description: "Include tickets from future sprints (default: false)",
      },
    },
    required: ["projectKey"],
  },
};

interface Sprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
}

export async function listSprintTicketsHandler(
  jira: Version3Client,
  customFieldsMap: Map<string, string>,
  args: { projectKey: string; includeOpen?: boolean; includeFuture?: boolean }
): Promise<McpResponse> {
  const { projectKey, includeOpen = true, includeFuture = false } = args;
  const sprintFieldId = customFieldsMap.get("Sprint") || "customfield_10020";

  const sprintFunctions: string[] = [];
  if (includeOpen) sprintFunctions.push("openSprints()");
  if (includeFuture) sprintFunctions.push("futureSprints()");

  if (sprintFunctions.length === 0) {
    return { content: [{ type: "text", text: "Error: at least one of includeOpen or includeFuture must be true" }], isError: true, _meta: {} };
  }

  const sprintFilter = sprintFunctions.length === 1
    ? `sprint in ${sprintFunctions[0]}`
    : `(sprint in ${sprintFunctions.join(" OR sprint in ")})`;

  const jql = `project = ${projectKey} AND ${sprintFilter} ORDER BY rank ASC`;
  const issues = await jira.issueSearch.searchForIssuesUsingJqlEnhancedSearch({
    jql,
    fields: ["summary", "status", "assignee", sprintFieldId],
  });

  const baseHost = (process.env.JIRA_HOST || "").replace(/\/+$/, "");
  const urlPattern = baseHost ? `${baseHost}/browse/{ISSUE_KEY}` : "{issue.self}";

  // Group issues by open/future sprint
  const sprintGroups = new Map<number, { sprint: Sprint; issues: any[] }>();

  for (const issue of issues.issues || []) {
    const sprints = ((issue.fields as any)[sprintFieldId] || []) as Sprint[];
    const relevantSprints = sprints.filter((s) => s.state !== "closed");

    if (relevantSprints.length === 0) {
      const key = 0;
      if (!sprintGroups.has(key)) {
        sprintGroups.set(key, { sprint: { id: 0, name: "Unknown Sprint", state: "unknown" }, issues: [] });
      }
      sprintGroups.get(key)!.issues.push(issue);
    } else {
      for (const sprint of relevantSprints) {
        if (!sprintGroups.has(sprint.id)) {
          sprintGroups.set(sprint.id, { sprint, issues: [] });
        }
        sprintGroups.get(sprint.id)!.issues.push(issue);
      }
    }
  }

  // Sort sprints by start date (earliest first)
  const sortedSprints = [...sprintGroups.values()].sort((a, b) => {
    const dateA = a.sprint.startDate || "";
    const dateB = b.sprint.startDate || "";
    return dateA.localeCompare(dateB);
  });

  // Format output grouped by sprint
  const sections = sortedSprints.map(({ sprint, issues }) => {
    const dateRange = sprint.startDate && sprint.endDate
      ? ` (${sprint.startDate.slice(0, 10)} - ${sprint.endDate.slice(0, 10)})`
      : "";
    const stateLabel = sprint.state ? ` [${sprint.state}]` : "";
    const lines = issues.map((issue: any) =>
      `  ${issue.key}: ${issue.fields.summary || "No summary"} (${issue.fields.status?.name || "No status"}) [Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}]`
    );
    return `## ${sprint.name} (id: ${sprint.id})${dateRange}${stateLabel}\n${lines.join("\n")}`;
  });

  const header = `Sprint field: ${sprintFieldId}\nTo move a ticket to a sprint, use update-issues with fields: {"${sprintFieldId}": <sprint-id>}\nURL pattern: ${urlPattern}`;

  const text = sections.length > 0
    ? `${header}\n\n${sections.join("\n\n")}`
    : "No issues found";

  return { content: [{ type: "text", text }], _meta: {} };
}
