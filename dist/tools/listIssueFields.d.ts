import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const listIssueFieldsDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            includeCustomOnly: {
                type: string;
                description: string;
            };
        };
    };
};
export declare function listIssueFieldsHandler(jira: Version3Client, customFieldsMap: Map<string, string>, args: {
    includeCustomOnly?: boolean;
}): Promise<McpResponse>;
