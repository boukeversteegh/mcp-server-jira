import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export interface MoveRequest {
    issueType: string;
    parentKey?: string;
}
/**
 * Detect whether an update entry is a "move" (issue type change).
 * Returns null when no type field is present.
 */
export declare function detectMove(fields: Record<string, any>): {
    move: MoveRequest;
} | {
    error: string;
} | null;
/**
 * Change the issue type of one or more issues (the Jira "Move" operation).
 */
export declare function moveIssuesCore(jira: Version3Client, issueKeys: string[], request: MoveRequest): Promise<McpResponse>;
