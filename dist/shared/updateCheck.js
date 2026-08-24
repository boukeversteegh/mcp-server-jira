import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
/**
 * Background check for new commits on the server's own git remote.
 *
 * Users install this server with `git clone` and update it with `git pull`, and a
 * stdio server has no way to talk to a human directly — stdout is the JSON-RPC
 * channel and stderr goes to logs nobody reads. So we check in the background at
 * startup and let the first tool result that finishes afterwards carry the notice.
 *
 * Every failure mode (no git, no remote, no upstream, offline, detached HEAD) is
 * silent: an update check must never be the reason a Jira tool call looks broken.
 */
let pendingNotice = null;
let noticeDelivered = false;
const FETCH_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 5_000;
export async function git(args, cwd, timeout = GIT_TIMEOUT_MS) {
    const { stdout } = await execFileAsync("git", args, { cwd, timeout, windowsHide: true });
    return stdout.trim();
}
/**
 * The repository this server runs from — resolved from the module's own location,
 * not process.cwd(), which belongs to the MCP client.
 */
export async function getRepoRoot() {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    return git(["rev-parse", "--show-toplevel"], moduleDir);
}
async function checkForUpdates() {
    const repoRoot = await getRepoRoot();
    // No upstream (detached HEAD, local-only branch) means there is nothing to compare against.
    await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], repoRoot);
    await git(["fetch", "--quiet"], repoRoot, FETCH_TIMEOUT_MS);
    const count = parseInt(await git(["rev-list", "--count", "HEAD..@{u}"], repoRoot), 10);
    if (!Number.isFinite(count) || count < 1)
        return;
    // %cs is the commit date as YYYY-MM-DD — enough to judge how stale a clone is.
    const subjects = await git(["log", "--format=%h %cs %s", "-n", "3", "HEAD..@{u}"], repoRoot);
    const commits = count === 1 ? "commit" : "commits";
    pendingNotice =
        `ℹ️ jira-mcp update available — ${count} new ${commits} in ${repoRoot}:\n` +
            subjects
                .split("\n")
                .filter(Boolean)
                .map((line) => `  ${line}`)
                .join("\n") +
            (count > 3 ? `\n  …and ${count - 3} more` : "") +
            `\nRun \`git pull\` there, then restart the MCP server.`;
}
/**
 * Kick off the check without blocking startup. Never rejects.
 */
export function startUpdateCheck() {
    if (process.env.JIRA_MCP_NO_UPDATE_CHECK)
        return;
    checkForUpdates().catch(() => {
        // Silent by design — see module comment.
    });
}
/**
 * Returns the notice at most once per server run, so it rides along with the first
 * tool result that completes after the check does, and never repeats after that.
 */
export function consumeUpdateNotice() {
    if (noticeDelivered || pendingNotice === null)
        return null;
    noticeDelivered = true;
    return pendingNotice;
}
/**
 * The notice for a failed tool call, repeated even if it was already delivered on an
 * earlier success. A tool call that just broke is the moment a waiting fix matters most,
 * so this is the one case worth saying twice.
 */
export function updateNoticeForError() {
    noticeDelivered = true;
    return pendingNotice;
}
