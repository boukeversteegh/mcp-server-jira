import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { respond, withJiraError } from "../utils.js";
import { convertADFToMarkdown } from "../shared/helpers.js";
import { contentVersion } from "../shared/contentVersion.js";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const exportContentDefinition = {
  name: "export-content",
  description:
    "Export a ticket description or a single comment to a local file (or return it inline), so it can be patched and re-uploaded with update-description / update-comment instead of being rewritten from scratch. Reports whether the exported markdown can be re-uploaded without losing content; when it cannot, export as 'adf' and patch the JSON instead.",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: { type: "string" },
      commentId: {
        type: "string",
        description: "Export this comment instead of the ticket description. Comment IDs are shown by get-ticket-details."
      },
      filePath: {
        type: "string",
        description:
          "Where to write the content (absolute, or relative to the server's working directory). The extension should match the format: .md for markdown, .json for adf. If omitted, the content is returned inline instead of written to disk."
      },
      format: {
        type: "string",
        enum: ["markdown", "adf"],
        description:
          "'markdown' (default) is readable and easy to patch, but cannot represent every Jira construct. 'adf' is the raw Atlassian Document Format Jira stores, so it always round-trips exactly."
      }
    },
    required: ["issueKey"]
  }
};

/**
 * ADF nodes and marks that convertADFToMarkdown can represent in a way markdown can be
 * parsed back from. Anything outside these sets renders as text for reading, but would be
 * downgraded or dropped if the markdown were re-uploaded.
 */
const MARKDOWN_SAFE_NODES = new Set([
  "doc", "paragraph", "heading", "bulletList", "orderedList", "listItem",
  "codeBlock", "blockquote", "rule", "text", "hardBreak",
]);
const MARKDOWN_SAFE_MARKS = new Set(["strong", "em", "strike", "code", "link"]);

/** Collect node and mark types that would not survive a markdown round-trip. */
function findLossyTypes(node: any, found = new Set<string>()): Set<string> {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) {
    for (const child of node) findLossyTypes(child, found);
    return found;
  }
  if (typeof node.type === "string" && !MARKDOWN_SAFE_NODES.has(node.type)) found.add(node.type);
  for (const mark of node.marks ?? []) {
    if (typeof mark?.type === "string" && !MARKDOWN_SAFE_MARKS.has(mark.type)) found.add(mark.type);
  }
  findLossyTypes(node.content, found);
  return found;
}

export async function exportContentHandler(
  jira: Version3Client,
  args: { issueKey: string; commentId?: string; filePath?: string; format?: "markdown" | "adf" }
): Promise<McpResponse> {
  const { issueKey, commentId, filePath, format = "markdown" } = args;

  return withJiraError(async () => {
    let adf: any;
    let label: string;
    let updated: string | undefined;

    if (commentId) {
      const comment: any = await jira.issueComments.getComment({ issueIdOrKey: issueKey, id: commentId });
      adf = comment?.body;
      updated = comment?.updated ?? comment?.created;
      label = `comment ${commentId} on ${issueKey}`;
    } else {
      const issue: any = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["description", "updated"] });
      adf = issue?.fields?.description;
      updated = issue?.fields?.updated;
      label = `description of ${issueKey}`;
    }

    const version = contentVersion(adf ?? null);

    if (!adf) {
      return respond(
        `The ${label} is empty — nothing to export.\n` +
        `Version: ${version} — pass this as expectedVersion to write content for the first time.`
      );
    }

    const text = format === "adf" ? JSON.stringify(adf, null, 2) : convertADFToMarkdown(adf);

    const lossy = format === "markdown" ? [...findLossyTypes(adf)].sort() : [];
    const fidelity =
      format === "adf"
        ? "Exported as ADF, so re-uploading this file with descriptionFormat/commentFormat 'adf' restores it exactly."
        : lossy.length === 0
          ? "This content uses only constructs markdown represents, so it can be patched and re-uploaded as markdown safely."
          : `WARNING: this content uses Jira constructs markdown cannot represent (${lossy.join(", ")}). ` +
            `Re-uploading the markdown would lose them — re-export with format: "adf" and patch the JSON instead.`;

    const header = [
      `Exported ${label} (format: ${format}, ${text.length} characters)`,
      `Version: ${version} — pass this as expectedVersion when uploading the edit back.`,
      updated ? `Last updated in Jira: ${updated}` : null,
      fidelity,
    ]
      .filter(Boolean)
      .join("\n");

    if (!filePath) {
      return respond(`${header}\n\n---\n${text}`);
    }

    const target = resolve(filePath);
    try {
      await writeFile(target, text, "utf8");
    } catch (e: any) {
      return respond(`Error writing ${target}: ${e?.message ?? String(e)}`);
    }

    const reupload = commentId
      ? `update-comment with issueKey "${issueKey}", commentId "${commentId}", filePath "${target}" and expectedVersion "${version}"`
      : `update-description with issueKey "${issueKey}", filePath "${target}" and expectedVersion "${version}"`;

    return respond(`${header}\nWritten to: ${target}\nEdit that file, then re-upload with ${reupload}.`);
  }, `Error exporting content from ${issueKey}`);
}
