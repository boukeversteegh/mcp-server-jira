import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";

interface UpdateEntry {
  issueKeys: string[];
  fields: Record<string, any>;
}

export const updateIssuesDefinition = {
  name: "update-issues",
  description:
    'Batch update fields on multiple tickets. Each entry in the updates array applies its fields to all issueKeys in that entry. Use a single entry to set the same fields on many issues, or multiple entries to set different fields per issue. For user fields (assignee, etc.), use {"accountId": "user-account-id"} format. Use the list-users tool to find account IDs.',
  inputSchema: {
    type: "object",
    properties: {
      updates: {
        type: "array",
        description:
          "Array of update operations. Each entry applies its fields to all issueKeys in that entry.",
        items: {
          type: "object",
          properties: {
            issueKeys: {
              type: "array",
              items: { type: "string" },
              description: "Issue keys to update with these fields.",
            },
            fields: {
              type: "object",
              additionalProperties: true,
              description: "Fields to set on the issues.",
            },
          },
          required: ["issueKeys", "fields"],
        },
      },
    },
    required: ["updates"],
  },
};

export async function updateIssuesHandler(
  jira: Version3Client,
  customFieldsMap: Map<string, string>,
  args: { updates: UpdateEntry[] }
): Promise<McpResponse> {
  const { updates } = args;

  if (!Array.isArray(updates) || updates.length === 0) {
    return {
      content: [{ type: "text", text: "Error: updates must be a non-empty array." }],
      isError: true,
      _meta: {},
    };
  }

  for (const entry of updates) {
    if (!Array.isArray(entry.issueKeys) || entry.issueKeys.length === 0) {
      return {
        content: [{ type: "text", text: "Error: each update entry must have a non-empty issueKeys array." }],
        isError: true,
        _meta: {},
      };
    }
    if (entry.fields.description !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: "Error: The 'description' field cannot be updated using this method. Please use the 'update-description' method instead.",
          },
        ],
        isError: true,
        _meta: {},
      };
    }
  }

  const successes: string[] = [];
  const errors: string[] = [];

  for (const entry of updates) {
    const processedFields = await resolveFields(jira, customFieldsMap, entry.fields);
    if (processedFields.error) {
      // Apply error to all issue keys in this entry
      for (const key of entry.issueKeys) {
        errors.push(`${key}: ${processedFields.error}`);
      }
      continue;
    }

    for (const issueKey of entry.issueKeys) {
      try {
        await jira.issues.editIssue({
          issueIdOrKey: issueKey,
          fields: processedFields.fields,
        });
        successes.push(issueKey);
      } catch (e: any) {
        errors.push(`${issueKey}: ${e?.message ?? String(e)}`);
      }
    }
  }

  const totalIssues = updates.reduce((sum, e) => sum + e.issueKeys.length, 0);
  let msg = `Updated ${successes.length} of ${totalIssues} issues.`;
  if (successes.length) msg += `\nSucceeded: ${successes.join(", ")}`;
  if (errors.length) msg += `\n\nFailed ${errors.length} issues:\n${errors.join("\n")}`;

  return {
    content: [{ type: "text", text: msg }],
    _meta: {},
  };
}

async function resolveFields(
  jira: Version3Client,
  customFieldsMap: Map<string, string>,
  fields: Record<string, any>
): Promise<{ fields: Record<string, any>; error?: never } | { fields?: never; error: string }> {
  const processedFields: Record<string, any> = { ...fields };

  // Resolve assignee by display name
  if (
    processedFields.assignee &&
    typeof processedFields.assignee === "object" &&
    processedFields.assignee.name &&
    !processedFields.assignee.accountId
  ) {
    const name = processedFields.assignee.name;
    try {
      const usersFound = await jira.userSearch.findUsers({ query: name });
      if (!usersFound || usersFound.length === 0) {
        return { error: `Assignee lookup failed. No user found with display name "${name}".` };
      }
      if (usersFound.length > 1) {
        const list = usersFound.map((u: any) => `${u.displayName} (${u.accountId})`).join(", ");
        return { error: `Assignee lookup failed. Multiple users found for "${name}": ${list}. Use accountId instead.` };
      }
      if (!usersFound[0].accountId) {
        return { error: `Assignee lookup failed. User "${usersFound[0].displayName}" has no accountId.` };
      }
      processedFields.assignee = { accountId: usersFound[0].accountId };
    } catch (e: any) {
      return { error: `Assignee lookup error: ${e.message}` };
    }
  } else if (
    processedFields.assignee &&
    typeof processedFields.assignee === "object" &&
    processedFields.assignee.name &&
    processedFields.assignee.accountId
  ) {
    delete processedFields.assignee.name;
  }

  // Map field names to Jira custom field IDs
  const finalFields: Record<string, any> = {};
  for (const [key, value] of Object.entries(processedFields)) {
    if (customFieldsMap.has(key)) {
      finalFields[customFieldsMap.get(key)!] = value;
    } else {
      finalFields[key] = value;
    }
  }

  return { fields: finalFields };
}
