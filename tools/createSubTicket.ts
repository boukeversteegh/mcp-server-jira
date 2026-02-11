import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
import { buildADF } from "../utils.js";

export const createSubTicketDefinition = {
  name: "create-sub-ticket",
  description: "Create a sub-ticket (child issue) for a parent ticket",
  inputSchema: {
    type: "object",
    properties: {
      parentKey: { type: "string" },
      summary: { type: "string" },
      description: {
        type: "string",
        description: "Description text. Use literal newlines (JSON \\n) for line breaks, not escaped backslashes."
      },
      descriptionFormat: {
        type: "string",
        enum: ["plain", "wiki", "markdown", "adf"],
        description:
          "Format of the description text: 'plain' (default) for simple text, 'wiki' for Jira wiki markup, 'markdown' for Markdown, 'adf' for raw ADF JSON"
      },
      issueType: {
        type: "string",
        description: "The name of the sub-task issue type (e.g., 'Sub-task')"
      }
    },
    required: ["parentKey", "summary"]
  }
};

export async function createSubTicketCore(
  jira: Version3Client,
  args: {
    parentKey: string;
    summary: string;
    description?: string;
    descriptionFormat?: DescriptionFormat;
    issueType?: string;
  }
): Promise<McpResponse> {
  const { parentKey, summary, description = "", descriptionFormat = "plain", issueType = "Sub-task" } = args;

  try {
    const parentIssue = await jira.issues.getIssue({
      issueIdOrKey: parentKey,
      fields: ["project", "issuetype"],
    });

    if (!parentIssue || !parentIssue.fields.project) {
      throw new Error(`Parent issue ${parentKey} not found or has no project`);
    }

    const createMeta = await jira.issues.getCreateIssueMeta({
      projectIds: [parentIssue.fields.project.id],
      expand: "projects.issuetypes",
    });

    const subtaskTypes =
      createMeta.projects?.[0]?.issuetypes?.filter((it: any) => it.subtask) || [];
    const availableIssueTypes = subtaskTypes.map((it: any) => it.name);

    const finalIssueType = availableIssueTypes.includes(issueType)
      ? issueType
      : availableIssueTypes[0] || "Sub-task";

    const createIssuePayload: any = {
      fields: {
        summary,
        parent: { key: parentKey },
        project: { id: parentIssue.fields.project.id },
        issuetype: { name: finalIssueType },
        ...(description ? { description: buildADF(description, descriptionFormat) } : {}),
      },
    };

    await jira.issues.createIssue(createIssuePayload);

    return {
      content: [{ type: "text", text: `🤖 Sub-ticket creation request sent for parent ${parentKey}` }],
      _meta: {},
    };
  } catch (error: any) {
    let errorDetails = `Error creating sub-ticket: ${error.message}`;
    if (error.response && error.response.data) {
      const responseData =
        typeof error.response.data === "object"
          ? JSON.stringify(error.response.data, null, 2)
          : error.response.data.toString();
      errorDetails += `\n\nResponse data:\n${responseData}`;
    }
    return { content: [{ type: "text", text: errorDetails }], isError: true, _meta: {} };
  }
}

export async function createSubTicketHandler(
  jira: Version3Client,
  args: {
    parentKey: string;
    summary: string;
    description?: string;
    descriptionFormat?: DescriptionFormat;
    issueType?: string;
  }
): Promise<McpResponse> {
  return createSubTicketCore(jira, args);
}