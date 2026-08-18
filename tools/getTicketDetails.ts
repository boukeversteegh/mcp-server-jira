import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { convertADFToMarkdown, formatFieldValue, formatSection, hasMeaningfulValue } from "../shared/helpers.js";

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function fetchDeployments(issueId: string, baseHost: string): Promise<any[]> {
  if (!issueId || !baseHost) return [];
  const auth = `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`;
  const headers = { Authorization: auth, Accept: "application/json" };

  try {
    const summaryUrl = `${baseHost}/rest/dev-status/1.0/issue/summary?issueId=${encodeURIComponent(issueId)}`;
    const summaryRes = await fetch(summaryUrl, { headers });
    if (!summaryRes.ok) return [];
    const summary: any = await summaryRes.json();
    const byType = summary?.summary?.deployment?.byInstanceType || {};
    const appTypes = Object.keys(byType).filter((t) => (byType[t]?.count || 0) > 0);
    if (appTypes.length === 0) return [];

    const results: any[] = [];
    for (const appType of appTypes) {
      const detailUrl = `${baseHost}/rest/dev-status/1.0/issue/detail?issueId=${encodeURIComponent(issueId)}&applicationType=${encodeURIComponent(appType)}&dataType=deployment`;
      const detailRes = await fetch(detailUrl, { headers });
      if (!detailRes.ok) continue;
      const detail: any = await detailRes.json();
      for (const entry of detail?.detail || []) {
        for (const dep of entry.deployments || []) {
          results.push({ ...dep, _instanceType: appType });
        }
      }
    }
    return results;
  } catch (error: any) {
    console.error(`Error fetching deployments: ${error.message}`);
    return [];
  }
}

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


export async function getTicketDetailsHandler(
  jira: Version3Client,
  customFieldsMap: Map<string, string>,
  args: { issueKey: string }
): Promise<McpResponse> {
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
    "attachment",
  ];

  const fieldsToFetch = [...standardFields, ...Array.from(customFieldsMap.values())];

  const issue: any = await jira.issues.getIssue({
    issueIdOrKey: issueKey,
    fields: fieldsToFetch,
  });
 
  const baseHost = (process.env.JIRA_HOST || "").replace(/\/+$/, "");
  const url = baseHost ? `${baseHost}/browse/${issue.key}` : (issue.self || "");

  const deployments = await fetchDeployments(issue.id, baseHost);
  const formattedDeployments =
    deployments.length > 0
      ? deployments
          .map((d: any) => {
            const env = d.environment?.displayName || d.environment?.type || "unknown env";
            const state = d.state || "unknown state";
            const when = d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : "unknown date";
            const name = d.displayName || `Deployment ${d.displayNumber || ""}`.trim();
            const link = d.url ? ` (${d.url})` : "";
            return `[${when}] ${env}: ${name} — ${state}${link} [${d._instanceType}]`;
          })
          .join("\n")
      : "";

  const description = convertADFToMarkdown(issue.fields.description);

  const linkedIssues = (issue.fields.issuelinks || [])
    .map((link: any) => {
      // Jira returns only the other end of the link, under the field naming that issue's
      // role: `inwardIssue` present means this issue is the outward side of the link.
      const relatedIssue = link.inwardIssue || link.outwardIssue;
      if (!relatedIssue) return null;
      const relation = (link.inwardIssue ? link.type?.outward : link.type?.inward) || "is linked to";
      const linkType = link.type?.name ? ` (type: "${link.type.name}")` : "";
      return `${relation} ${relatedIssue.key} ${relatedIssue.fields?.summary || "No summary"} [${relatedIssue.fields?.issuetype?.name || "Unknown type"}, ${relatedIssue.fields?.status?.name || "Unknown status"}]${linkType}`;
    })
    .filter(Boolean)
    .join("\n");

  const subtasks = (issue.fields.subtasks || [])
    .map(
      (subtask: any) =>
        `${subtask.key} ${subtask.fields?.summary || "No summary"} [${subtask.fields?.issuetype?.name || "Unknown type"}, ${subtask.fields?.status?.name || "Unknown status"}]`
    )
    .join("\n");

  const relatedIssues = [linkedIssues || "No linked issues", subtasks || "No sub-tasks"]
    .filter((section) => section)
    .join("\n\n");

  const comments = (issue.fields as any).comment?.comments || [];
  const formattedComments =
    comments.length > 0
      ? comments
          .map((comment: any) => {
            const created = comment.created ? new Date(comment.created).toLocaleString() : "Unknown date";
            const author = comment.author?.displayName || "Unknown user";
            let body = "";
            if (typeof comment.body === "string") {
              body = comment.body;
            } else if (comment.body && typeof comment.body === "object") {
              body = convertADFToMarkdown(comment.body);
            } else {
              body = "No content";
            }
            return `[${created}] ${author} (ID: ${comment.id}):\n${body}`;
          })
          .join("\n\n")
      : "No comments";

  const attachments = ((issue.fields as any).attachment || []) as any[];
  const formattedAttachments =
    attachments.length > 0
      ? attachments
          .map((a: any) => {
            const size = a.size != null ? formatFileSize(a.size) : "unknown size";
            const created = a.created ? new Date(a.created).toLocaleString() : "unknown date";
            const author = a.author?.displayName || "unknown";
            return `ID: ${a.id} | ${a.filename} (${a.mimeType}, ${size}) | by ${author} on ${created}`;
          })
          .join("\n")
      : "";

  const customFieldsData: Record<string, string> = {};
  for (const [fieldName, fieldId] of customFieldsMap.entries()) {
    const raw = (issue.fields as any)[fieldId];
    if (hasMeaningfulValue(raw)) {
      customFieldsData[fieldName] = formatFieldValue(raw);
    }
  }

  const customFieldsSection =
    Object.keys(customFieldsData).length > 0
      ? `Custom Fields:
${Object.entries(customFieldsData)
  .map(([name, value]) => `${name}: ${value}`)
  .join("\n")}`
      : "";

  return {
    content: [
      {
        type: "text",
        text: [
          `Key: ${issue.key}`,
          `URL: ${url}`,
          `Title: ${issue.fields.summary || "No summary"}`,
          `Type: ${issue.fields.issuetype?.name || "Unknown type"}`,
          `Status: ${issue.fields.status?.name || "No status"}`,
          `Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}`,
          `Labels: ${Array.isArray(issue.fields.labels) && issue.fields.labels.length > 0 ? issue.fields.labels.join(", ") : "No labels"}`,
          `Parent: ${(issue.fields as any).parent ? `${(issue.fields as any).parent.key} (${(issue.fields as any).parent.fields?.issuetype?.name || "Unknown type"}) - ${(issue.fields as any).parent.fields?.summary || "No summary"}` : "No parent"}`,
          `Created: ${issue.fields.created || "Unknown"}`,
          `Updated: ${issue.fields.updated || "Unknown"}`,
          "",
          formatSection("Description", description),
          "",
          formatSection("Related Issues", relatedIssues),
          "",
          ...(formattedAttachments ? [formatSection("Attachments", formattedAttachments), ""] : []),
          ...(formattedDeployments ? [formatSection("Deployments", formattedDeployments), ""] : []),
          ...(customFieldsSection ? [formatSection("Custom Fields", customFieldsSection.replace(/^Custom Fields:\n/, "")), ""] : []),
          formatSection("Comments", formattedComments),
        ].join("\n"),
      },
    ],
    _meta: {},
  };
}