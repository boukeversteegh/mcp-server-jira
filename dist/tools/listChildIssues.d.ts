import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const listChildIssuesDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            parentKey: {
                type: string;
            };
        };
        required: string[];
    };
};
export declare function listChildIssuesHandler(jira: Version3Client, args: {
    parentKey: string;
}): Promise<McpResponse>;
