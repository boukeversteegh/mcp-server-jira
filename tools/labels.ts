import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, validateArray, withJiraError } from "../utils.js";

export const labelsDefinition = {
  name: "labels",
  description: "Manage labels on issues. Modes: 'add' appends labels, 'remove' removes labels, 'set' replaces all labels.",
  inputSchema: {
    type: "object",
    properties: {
      issueKeys: {
        type: "array",
        items: { type: "string" },
        description: "List of issue keys to modify"
      },
      labels: {
        type: "array",
        items: { type: "string" },
        description: "Labels to add, remove, or set"
      },
      mode: {
        type: "string",
        enum: ["add", "remove", "set"],
        description: "Operation mode: 'add' (default) appends labels, 'remove' removes labels, 'set' replaces all labels"
      }
    },
    required: ["issueKeys", "labels"]
  }
};

export async function labelsHandler(
  jira: Version3Client,
  args: { issueKeys: string[]; labels: string[]; mode?: "add" | "remove" | "set" }
): Promise<McpResponse> {
  const { issueKeys, labels, mode = "add" } = args;

  const issuesErr = validateArray("issueKeys", issueKeys);
  if (issuesErr) return respond(issuesErr.replace("array", "array of issue keys"));
  const labelsErr = validateArray("labels", labels);
  if (labelsErr) return respond(labelsErr.replace("array", "array of label strings"));

  return withJiraError(async () => {
    const results: string[] = [];
    const errors: string[] = [];

    for (const issueKey of issueKeys) {
      try {
        let newLabels: string[];

        if (mode === "set") {
          // Replace all labels
          newLabels = labels;
        } else {
          // Fetch existing labels for add/remove modes
          const issue = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["labels"] });
          const existing = Array.isArray(issue.fields.labels) ? issue.fields.labels : [];

          if (mode === "add") {
            newLabels = [...new Set([...existing, ...labels])];
          } else {
            // mode === "remove"
            const toRemove = new Set(labels);
            newLabels = existing.filter(l => !toRemove.has(l));
          }
        }

        await jira.issues.editIssue({
          issueIdOrKey: issueKey,
          fields: { labels: newLabels },
        });

        results.push(`${issueKey}: labels => [${newLabels.join(", ")}]`);
      } catch (e: any) {
        errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
      }
    }

    let msg = "";
    if (results.length > 0) {
      msg += `Updated ${results.length} of ${issueKeys.length} issues (mode: ${mode}).\n` + results.join("\n");
    }
    if (errors.length > 0) {
      if (msg) msg += "\n\n";
      msg += `Failed ${errors.length} issues:\n` + errors.join("\n");
    }

    const response = respond(msg || "No issues processed.");
    if (errors.length === issueKeys.length) response.isError = true;
    return response;
  }, "Error managing labels");
}
