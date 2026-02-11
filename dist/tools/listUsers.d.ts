import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const listUsersDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            maxResults: {
                type: string;
                description: string;
            };
        };
    };
};
export declare function listUsersHandler(jira: Version3Client, args?: {
    maxResults?: number;
}): Promise<McpResponse>;
