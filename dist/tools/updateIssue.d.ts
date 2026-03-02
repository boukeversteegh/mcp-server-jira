import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
interface UpdateEntry {
    issueKeys: string[];
    fields: Record<string, any>;
}
export declare const updateIssuesDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            updates: {
                type: string;
                description: string;
                items: {
                    type: string;
                    properties: {
                        issueKeys: {
                            type: string;
                            items: {
                                type: string;
                            };
                            description: string;
                        };
                        fields: {
                            type: string;
                            additionalProperties: boolean;
                            description: string;
                        };
                    };
                    required: string[];
                };
            };
        };
        required: string[];
    };
};
export declare function updateIssuesHandler(jira: Version3Client, customFieldsMap: Map<string, string>, args: {
    updates: UpdateEntry[];
}): Promise<McpResponse>;
export {};
