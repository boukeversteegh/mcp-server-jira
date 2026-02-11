import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const updateIssuesDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKeys: {
                type: string;
                items: {
                    type: string;
                };
            };
            fields: {
                type: string;
                additionalProperties: boolean;
            };
        };
        required: string[];
    };
};
export declare function updateIssuesHandler(jira: Version3Client, customFieldsMap: Map<string, string>, args: {
    issueKeys: string[];
    fields: Record<string, any>;
}): Promise<McpResponse>;
