import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import {
  respond,
  fail,
  withJiraError,
  validateString,
  validateArray,
} from "../utils.js";
import { formatFileSize } from "./getAttachment.js";
import * as fs from "fs";
import * as path from "path";

export const addAttachmentDefinition = {
  name: "add-attachment",
  description:
    "Upload one or more local files as attachments to a Jira issue. Jira has no separate comment attachments: a file shown in a comment is an issue attachment, so upload it here first.",
  inputSchema: {
    type: "object",
    properties: {
      issueKey: {
        type: "string",
        description: "The issue key (e.g., PROJ-123)",
      },
      filePaths: {
        type: "array",
        items: { type: "string" },
        description:
          "Paths of the local files to upload. The attachment keeps the file's name.",
      },
    },
    required: ["issueKey", "filePaths"],
  },
};

export async function addAttachmentHandler(
  jira: Version3Client,
  args: { issueKey: string; filePaths: string[] },
): Promise<McpResponse> {
  const { issueKey, filePaths } = args;

  const err =
    validateString("issueKey", issueKey) ??
    validateArray("filePaths", filePaths);
  if (err) return fail(err);

  // Check every file before uploading any, so a typo in one path never leaves the
  // issue with only some of the requested attachments.
  const missing = filePaths.filter(
    (p) =>
      typeof p !== "string" || !fs.existsSync(p) || !fs.statSync(p).isFile(),
  );
  if (missing.length > 0) {
    return fail(`Error: not a readable file: ${missing.join(", ")}`);
  }

  return withJiraError(async () => {
    const created: any[] = await jira.issueAttachments.addAttachment({
      issueIdOrKey: issueKey,
      attachment: filePaths.map((p) => ({
        filename: path.basename(p),
        file: fs.readFileSync(p),
      })),
    });

    const lines = created.map(
      (a) =>
        `ID: ${a.id} | ${a.filename} (${a.mimeType}, ${formatFileSize(a.size ?? 0)})`,
    );
    return respond(
      `Uploaded ${created.length} attachment(s) to ${issueKey}:\n\n${lines.join("\n")}`,
    );
  }, `Error uploading attachments to ${issueKey}`);
}
