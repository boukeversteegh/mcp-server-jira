import { Version3Client } from "jira.js";
import * as fs from "fs";
import * as path from "path";

/**
 * Embedding files in descriptions and comments.
 *
 * Jira has no comment attachments: a file shown in a comment or description is an issue
 * attachment, referenced from the ADF by a media node. That node does not carry the
 * attachment ID but the file's Media Services UUID:
 *
 *   { type: "media", attrs: { type: "file", id: "3f2a8c1e-…", collection: "" } }
 *
 * The attachment REST resource never reports that UUID. It only shows up in the redirect
 * Jira answers a download with (`/rest/api/3/attachment/content/{id}` → 303 to
 * `https://api.media.atlassian.com/file/{uuid}/binary?…`), so that is where it is read from.
 *
 * Authors reference files with the syntax of their format, which both converters already
 * turn into media nodes holding the reference as a placeholder:
 *  - markdown `![alt](./shot.png)` → `{ type: "external", url: "./shot.png" }`
 *  - wiki `!shot.png!` / `[^report.pdf]` → `{ type: "file", id: "shot.png" }`
 * Those placeholders are resolved here and rewritten into real attachment references.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_SCHEME = /^(https?|data):/i;
const EXPLICIT_PREFIX = "attachment:";

type Attachment = {
  id: string;
  filename: string;
  size?: number;
  mimeType?: string;
  content?: string;
  created?: string;
};

type MediaRef = { node: any; parent: any; ref: string };

/** A placeholder resolved to the attachment it will point at. */
type Resolution =
  | { kind: "existing"; ref: string; attachment: Attachment }
  | { kind: "upload"; ref: string; localPath: string };

export type EmbedPlan = {
  refs: MediaRef[];
  resolutions: Map<string, Resolution>;
};

/** Media nodes whose reference is a placeholder rather than an uploaded file or a URL. */
function findMediaRefs(adf: any): MediaRef[] {
  const refs: MediaRef[] = [];
  const walk = (node: any, parent: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "media" && node.attrs) {
      const { type, url, id } = node.attrs;
      if (
        type === "external" &&
        typeof url === "string" &&
        !URL_SCHEME.test(url)
      ) {
        refs.push({ node, parent, ref: url });
      } else if (type === "file" && typeof id === "string" && !UUID.test(id)) {
        refs.push({ node, parent, ref: id });
      }
    }
    if (Array.isArray(node.content))
      node.content.forEach((child: any) => walk(child, node));
  };
  walk(adf, null);
  return refs;
}

/** Newest attachment matching an ID or filename. */
function findAttachment(
  attachments: Attachment[],
  key: string,
): Attachment | undefined {
  const matches = attachments.filter(
    (a) => String(a.id) === key || a.filename === key,
  );
  return matches.sort((a, b) =>
    String(b.created ?? "").localeCompare(String(a.created ?? "")),
  )[0];
}

/** Local file a reference points at, if any. Markdown references may be URL-encoded. */
function localFile(ref: string, baseDir: string): string | null {
  const candidates = [ref];
  try {
    const decoded = decodeURIComponent(ref);
    if (decoded !== ref) candidates.push(decoded);
  } catch {
    // Not URL-encoded; the raw reference is the only candidate.
  }
  for (const candidate of candidates) {
    const full = path.resolve(baseDir, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

/**
 * Resolve every placeholder in `adf` without changing anything in Jira, so a bad reference
 * is reported before any file is uploaded or any content is written.
 *
 * Resolution order per reference:
 *  1. `attachment:<filename or ID>` — an attachment already on the issue, nothing else.
 *  2. A local file (relative to `baseDir`) — uploaded, unless the issue already has an
 *     attachment with the same name and size, which is reused so that re-sending an edited
 *     file does not attach the same screenshot again on every update.
 *  3. An attachment already on the issue with that filename or ID.
 *
 * `issueKey` is omitted when the issue does not exist yet (ticket creation).
 */
export async function planEmbeds(
  jira: Version3Client,
  issueKey: string | undefined,
  adf: any,
  baseDir: string,
): Promise<{ plan: EmbedPlan } | { error: string }> {
  const refs = findMediaRefs(adf);
  const resolutions = new Map<string, Resolution>();
  if (refs.length === 0) return { plan: { refs, resolutions } };

  let existing: Attachment[] = [];
  if (issueKey) {
    const issue: any = await jira.issues.getIssue({
      issueIdOrKey: issueKey,
      fields: ["attachment"],
    });
    existing = issue?.fields?.attachment ?? [];
  }

  const unresolved: string[] = [];
  for (const { ref } of refs) {
    if (resolutions.has(ref)) continue;

    if (ref.startsWith(EXPLICIT_PREFIX)) {
      const attachment = findAttachment(
        existing,
        ref.slice(EXPLICIT_PREFIX.length),
      );
      if (attachment)
        resolutions.set(ref, { kind: "existing", ref, attachment });
      else
        unresolved.push(
          `${ref} (no such attachment on ${issueKey ?? "a ticket that does not exist yet"})`,
        );
      continue;
    }

    const localPath = localFile(ref, baseDir);
    if (localPath) {
      const size = fs.statSync(localPath).size;
      const same = existing.find(
        (a) => a.filename === path.basename(localPath) && a.size === size,
      );
      resolutions.set(
        ref,
        same
          ? { kind: "existing", ref, attachment: same }
          : { kind: "upload", ref, localPath },
      );
      continue;
    }

    const attachment = findAttachment(existing, ref);
    if (attachment) resolutions.set(ref, { kind: "existing", ref, attachment });
    else
      unresolved.push(
        `${ref} (not a file under ${baseDir}, nor an attachment on the ticket)`,
      );
  }

  if (unresolved.length > 0) {
    return {
      error:
        `Error: cannot embed ${unresolved.length} file reference(s):\n` +
        unresolved.map((u) => `  - ${u}`).join("\n") +
        `\nNothing was uploaded or written. Paths are resolved relative to ${baseDir}; ` +
        `use "${EXPLICIT_PREFIX}<filename or ID>" to point at an attachment already on the ticket.`,
    };
  }
  return { plan: { refs, resolutions } };
}

/** Media Services UUID of an attachment, read from the redirect of its download URL. */
export async function fetchMediaId(attachment: Attachment): Promise<string> {
  if (!attachment.content)
    throw new Error(`Attachment ${attachment.id} has no content URL`);
  const response = await fetch(attachment.content, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64")}`,
    },
    redirect: "manual",
  });
  const location = response.headers.get("location") ?? "";
  const match = location.match(/\/file\/([0-9a-f-]{36})\//i);
  if (!match) {
    throw new Error(
      `Could not determine the media ID of attachment ${attachment.id} (HTTP ${response.status})`,
    );
  }
  return match[1]!;
}

function isImage(attachment: Attachment): boolean {
  if (attachment.mimeType) return attachment.mimeType.startsWith("image/");
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(attachment.filename);
}

/**
 * Upload what the plan needs and rewrite the placeholders in `adf`, in place.
 * Returns one line per embedded file, for the tool's result message.
 */
export async function applyEmbeds(
  jira: Version3Client,
  issueKey: string,
  plan: EmbedPlan,
  mediaIdOf: (attachment: Attachment) => Promise<string> = fetchMediaId,
): Promise<string[]> {
  const { refs, resolutions } = plan;
  if (refs.length === 0) return [];

  const uploads = [...resolutions.values()].filter(
    (r): r is Extract<Resolution, { kind: "upload" }> => r.kind === "upload",
  );
  const uploaded = new Map<string, Attachment>();
  if (uploads.length > 0) {
    const created: Attachment[] = await jira.issueAttachments.addAttachment({
      issueIdOrKey: issueKey,
      attachment: uploads.map((u) => ({
        filename: path.basename(u.localPath),
        file: fs.readFileSync(u.localPath),
      })),
    });
    // Jira answers with the attachments in upload order.
    uploads.forEach((u, i) => uploaded.set(u.ref, created[i]!));
  }

  const lines: string[] = [];
  const mediaIds = new Map<string, string>();
  for (const resolution of resolutions.values()) {
    const attachment =
      resolution.kind === "upload"
        ? uploaded.get(resolution.ref)!
        : resolution.attachment;
    mediaIds.set(resolution.ref, await mediaIdOf(attachment));
    const how = resolution.kind === "upload" ? "uploaded" : "already attached";
    lines.push(
      `${resolution.ref} → ${attachment.filename} (attachment ${attachment.id}, ${how})`,
    );
  }

  for (const { node, parent, ref } of refs) {
    const resolution = resolutions.get(ref)!;
    const attachment =
      resolution.kind === "upload" ? uploaded.get(ref)! : resolution.attachment;
    node.attrs = {
      type: "file",
      id: mediaIds.get(ref),
      collection: "",
      alt: node.attrs.alt || attachment.filename,
    };
    // A file that is not an image renders as a file card, which belongs in a mediaGroup.
    if (parent?.type === "mediaSingle" && !isImage(attachment)) {
      parent.type = "mediaGroup";
      delete parent.attrs;
    }
  }

  return lines;
}

/**
 * Ticket creation: files can only be attached to an issue that exists, so a description that
 * embeds files is left out of the create call and written here once the issue is there.
 * Returns the embed lines for the result message, or an error naming what is missing.
 */
export async function writeDeferredDescription(
  jira: Version3Client,
  issueKey: string,
  adf: object,
  plan: EmbedPlan,
): Promise<{ lines: string[] } | { error: string }> {
  try {
    const lines = await applyEmbeds(jira, issueKey, plan);
    await jira.issues.editIssue({
      issueIdOrKey: issueKey,
      fields: { description: adf },
    });
    return { lines };
  } catch (e: any) {
    const data = e?.response?.data
      ? `\n\nResponse data:\n${JSON.stringify(e.response.data, null, 2)}`
      : "";
    return {
      error:
        `Created ${issueKey}, but embedding files in its description failed, so it has no description yet: ` +
        `${e?.message ?? String(e)}${data}\nRetry with update-description on ${issueKey}.`,
    };
  }
}

/** Directory relative file references resolve against: the content file's, else the cwd. */
export function embedBaseDir(filePath: string | undefined): string {
  return filePath ? path.dirname(path.resolve(filePath)) : process.cwd();
}

/** Result-message section listing embedded files; empty when there were none. */
export function formatEmbedLines(lines: string[]): string {
  return lines.length > 0
    ? `\nEmbedded ${lines.length} file(s):\n${lines.map((l) => `  - ${l}`).join("\n")}`
    : "";
}
