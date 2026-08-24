export declare function git(args: string[], cwd: string, timeout?: number): Promise<string>;
/**
 * The repository this server runs from — resolved from the module's own location,
 * not process.cwd(), which belongs to the MCP client.
 */
export declare function getRepoRoot(): Promise<string>;
/**
 * Kick off the check without blocking startup. Never rejects.
 */
export declare function startUpdateCheck(): void;
/**
 * Returns the notice at most once per server run, so it rides along with the first
 * tool result that completes after the check does, and never repeats after that.
 */
export declare function consumeUpdateNotice(): string | null;
/**
 * The notice for a failed tool call, repeated even if it was already delivered on an
 * earlier success. A tool call that just broke is the moment a waiting fix matters most,
 * so this is the one case worth saying twice.
 */
export declare function updateNoticeForError(): string | null;
