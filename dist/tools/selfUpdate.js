import { respond, fail } from "../utils.js";
import { git, getRepoRoot, consumeUpdateNotice } from "../shared/updateCheck.js";
const PULL_TIMEOUT_MS = 60_000;
export const selfUpdateDefinition = {
    name: "self-update",
    description: "Update this Jira MCP server itself by pulling the latest commits from its git remote (fast-forward only). Refuses to run when the server's repository has uncommitted changes. The MCP server must be restarted afterwards for the update to take effect.",
    inputSchema: {
        type: "object",
        properties: {},
    },
};
export async function selfUpdateHandler() {
    // Whatever the startup check found is about to be either applied or reported here.
    consumeUpdateNotice();
    let repoRoot;
    try {
        repoRoot = await getRepoRoot();
    }
    catch {
        return fail("Error: this server is not running from a git repository, so it cannot update itself. Reinstall it with `git clone`.");
    }
    try {
        // Tracked changes only: untracked files (a local .claude/, scratch notes) never
        // block a fast-forward, so refusing over them would be a false alarm.
        const dirty = await git(["status", "--porcelain", "--untracked-files=no"], repoRoot);
        if (dirty) {
            const files = dirty.split("\n").slice(0, 10).join("\n");
            const more = dirty.split("\n").length > 10 ? `\n…and more` : "";
            return fail(`Error: ${repoRoot} has uncommitted changes, so it was not updated.\n\n${files}${more}\n\n` +
                `Commit or stash them, then run self-update again.`);
        }
        const before = await git(["rev-parse", "HEAD"], repoRoot);
        await git(["pull", "--ff-only"], repoRoot, PULL_TIMEOUT_MS);
        const after = await git(["rev-parse", "HEAD"], repoRoot);
        if (before === after) {
            return respond(`Already up to date — ${repoRoot} is at ${before.slice(0, 7)}.`);
        }
        const log = await git(["log", "--oneline", "--no-decorate", `${before}..${after}`], repoRoot);
        const changed = await git(["diff", "--name-only", `${before}..${after}`], repoRoot);
        const depsChanged = changed
            .split("\n")
            .some((f) => f === "package.json" || f === "package-lock.json");
        return respond(`Updated ${repoRoot} to ${after.slice(0, 7)}:\n\n` +
            log
                .split("\n")
                .filter(Boolean)
                .map((line) => `  ${line}`)
                .join("\n") +
            `\n\n` +
            (depsChanged
                ? `Dependencies changed — run \`npm install\` in ${repoRoot}, then restart the MCP server.`
                : `Restart the MCP server to load the new version. The running process still serves the old code.`));
    }
    catch (e) {
        // A non-fast-forward pull, a network failure, or a diverged branch all land here.
        const detail = [e?.stderr, e?.stdout, e?.message].find((s) => typeof s === "string" && s.trim());
        return fail(`Error updating ${repoRoot}: ${detail?.trim() ?? String(e)}\n\n` +
            `Update it manually with \`git pull\` and restart the MCP server.`);
    }
}
