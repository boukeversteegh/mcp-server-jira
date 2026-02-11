import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const listIssueTransitionsDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKey: {
                type: string;
            };
        };
        required: string[];
    };
};
export declare function listIssueTransitionsHandler(jira: Version3Client, args: {
    issueKey: string;
}): Promise<McpResponse>;
