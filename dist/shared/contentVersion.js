import { createHash } from "node:crypto";
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
function canonical(value) {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value) ?? "null";
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}
/** Version token for a piece of ADF content. Empty content has a stable version of its own. */
export function contentVersion(adf) {
    const hash = createHash("sha256").update(canonical(adf ?? null)).digest("hex");
    return `v1-${hash.slice(0, 12)}`;
}
/**
 * Current ADF of a description or a single comment, with the timestamp Jira reports for it.
 * The timestamp is for humans reading the message; the lock itself is the content version.
 */
export async function fetchContent(jira, issueKey, commentId) {
    if (commentId) {
        const comment = await jira.issueComments.getComment({ issueIdOrKey: issueKey, id: commentId });
        return { adf: comment?.body ?? null, updated: comment?.updated ?? comment?.created };
    }
    const issue = await jira.issues.getIssue({ issueIdOrKey: issueKey, fields: ["description", "updated"] });
    return { adf: issue?.fields?.description ?? null, updated: issue?.fields?.updated };
}
/**
 * Enforce the version lock before an update. Returns an error message when the caller must
 * stop, or null when the update may proceed.
 */
export async function checkVersion(opts) {
    const { jira, issueKey, commentId, expectedVersion, force = false } = opts;
    const what = commentId ? `comment ${commentId} on ${issueKey}` : `description of ${issueKey}`;
    if (force)
        return null;
    const { adf, updated } = await fetchContent(jira, issueKey, commentId);
    const current = contentVersion(adf);
    const when = updated ? `, last updated ${updated}` : "";
    // Writing into emptiness needs no version. Omitting it asserts "there is nothing here yet",
    // which the server can check itself, so a first write does not have to obtain the version of
    // empty content first. The assertion is still enforced: a description written meanwhile is
    // refused the same as any other conflict.
    if (!expectedVersion) {
        if (!adf)
            return null;
        return (`Error: the ${what} is not empty (version ${current}${when}), so updating it requires ` +
            `expectedVersion — otherwise an edit made in Jira meanwhile would be silently overwritten. ` +
            `Run export-content to get the current content and version, or pass force: true to ` +
            `overwrite regardless.`);
    }
    if (current === expectedVersion.trim())
        return null;
    return (`Error: the ${what} changed in Jira since version ${expectedVersion} was issued (it is now ${current}${when}). ` +
        `Uploading would discard that change. Re-run export-content to get the current content, re-apply ` +
        `your edit, and upload with the new version — or pass force: true to overwrite it.`);
}
