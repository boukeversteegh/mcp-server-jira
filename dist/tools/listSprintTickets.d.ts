import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const listSprintTicketsDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            projectKey: {
                type: string;
            };
            includeOpen: {
                type: string;
                description: string;
            };
            includeFuture: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function listSprintTicketsHandler(jira: Version3Client, customFieldsMap: Map<string, string>, args: {
    projectKey: string;
    includeOpen?: boolean;
    includeFuture?: boolean;
}): Promise<McpResponse>;
