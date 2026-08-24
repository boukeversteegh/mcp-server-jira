import { createHash } from "node:crypto";
import { Version3Client } from "jira.js";

/**
 * Optimistic concurrency for descriptions and comments.
 *
 * Confluence hands out a page version number and rejects an update carrying a stale one.
 * Jira has no equivalent: an issue's `updated` timestamp moves for any change at all — a
 * transition, a label, an assignee — so using it as a lock would reject description patches
 * that never conflicted with anything. Instead the version is derived from the content
 * itself, so it changes exactly when the thing being patched changes.
 */

/** Stable stringify: key order must not affect the version. */
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

/** Version token for a piece of ADF content. Empty content has a stable version of its own. */
export function contentVersion(adf: any): string {
  const hash = createHash("sha256").update(canonical(adf ?? null)).digest("hex");
  return `v1-${hash.slice(0, 12)}`;
}

/**
 * Current ADF of a description or a single comment, with the timestamp Jira reports for it.
 * The timestamp is for humans reading the message; the lock itself is the content version.
 */
export async function fetchContent(
  jira: Version3Client,
  issueKey: string,
  commentId?: string | undefined
): Promise<{ adf: any; updated?: string }> {
  if (commentId) {
    const comment: any = await jira.issueComments.getComment({ issueIdOrKey: issueKey, id: commentId });
    return { adf: comment?.body ?? null, updated: comment?.updated ?? comment?.created };
  }
  const issue: any = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["description", "updated"] });
  return { adf: issue?.fields?.description ?? null, updated: issue?.fields?.updated };
}

/**
 * Enforce the version lock before an update. Returns an error message when the caller must
 * stop, or null when the update may proceed.
 */
export async function checkVersion(opts: {
  jira: Version3Client;
  issueKey: string;
  commentId?: string | undefined;
  expectedVersion?: string | undefined;
  force?: boolean | undefined;
}): Promise<string | null> {
  const { jira, issueKey, commentId, expectedVersion, force = false } = opts;
  const what = commentId ? `comment ${commentId} on ${issueKey}` : `description of ${issueKey}`;

  if (force) return null;

  if (!expectedVersion) {
    return (
      `Error: updating the ${what} requires expectedVersion, so an edit made in Jira meanwhile ` +
      `cannot be silently overwritten. Run export-content to get the current version (it reports ` +
      `one even when the content is empty), or pass force: true to overwrite regardless.`
    );
  }

  const { adf, updated } = await fetchContent(jira, issueKey, commentId);
  const current = contentVersion(adf);
  if (current === expectedVersion.trim()) return null;

  const when = updated ? `, last updated ${updated}` : "";
  return (
    `Error: the ${what} changed in Jira since version ${expectedVersion} was issued (it is now ${current}${when}). ` +
    `Uploading would discard that change. Re-run export-content to get the current content, re-apply ` +
    `your edit, and upload with the new version — or pass force: true to overwrite it.`
  );
}
