import { Version3Client } from "jira.js";
/** Version token for a piece of ADF content. Empty content has a stable version of its own. */
export declare function contentVersion(adf: any): string;
/**
 * Current ADF of a description or a single comment, with the timestamp Jira reports for it.
 * The timestamp is for humans reading the message; the lock itself is the content version.
 * For a comment, its visibility restriction comes along, so a rewrite can keep it.
 */
export declare function fetchContent(jira: Version3Client, issueKey: string, commentId?: string | undefined): Promise<{
    adf: any;
    updated?: string;
    visibility?: any;
}>;
/**
 * Enforce the version lock before an update. Returns an error message when the caller must
 * stop, or null when the update may proceed.
 */
export declare function checkVersion(opts: {
    jira: Version3Client;
    issueKey: string;
    commentId?: string | undefined;
    expectedVersion?: string | undefined;
    force?: boolean | undefined;
}): Promise<string | null>;
