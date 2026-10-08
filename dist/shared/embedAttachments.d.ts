import { Version3Client } from "jira.js";
type Attachment = {
    id: string;
    filename: string;
    size?: number;
    mimeType?: string;
    content?: string;
    created?: string;
};
type MediaRef = {
    node: any;
    parent: any;
    ref: string;
};
/** A placeholder resolved to the attachment it will point at. */
type Resolution = {
    kind: "existing";
    ref: string;
    attachment: Attachment;
} | {
    kind: "upload";
    ref: string;
    localPath: string;
};
export type EmbedPlan = {
    refs: MediaRef[];
    resolutions: Map<string, Resolution>;
};
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
export declare function planEmbeds(jira: Version3Client, issueKey: string | undefined, adf: any, baseDir: string): Promise<{
    plan: EmbedPlan;
} | {
    error: string;
}>;
/** Media Services UUID of an attachment, read from the redirect of its download URL. */
export declare function fetchMediaId(attachment: Attachment): Promise<string>;
/**
 * Upload what the plan needs and rewrite the placeholders in `adf`, in place.
 * Returns one line per embedded file, for the tool's result message.
 */
export declare function applyEmbeds(jira: Version3Client, issueKey: string, plan: EmbedPlan, mediaIdOf?: (attachment: Attachment) => Promise<string>): Promise<string[]>;
/**
 * Ticket creation: files can only be attached to an issue that exists, so a description that
 * embeds files is left out of the create call and written here once the issue is there.
 * Returns the embed lines for the result message, or an error naming what is missing.
 */
export declare function writeDeferredDescription(jira: Version3Client, issueKey: string, adf: object, plan: EmbedPlan): Promise<{
    lines: string[];
} | {
    error: string;
}>;
/** Directory relative file references resolve against: the content file's, else the cwd. */
export declare function embedBaseDir(filePath: string | undefined): string;
/** Result-message section listing embedded files; empty when there were none. */
export declare function formatEmbedLines(lines: string[]): string;
export {};
