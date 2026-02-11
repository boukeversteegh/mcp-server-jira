import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const getTicketDetailsDefinition: {
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
export declare function getTicketDetailsHandler(jira: Version3Client, customFieldsMap: Map<string, string>, args: {
    issueKey: string;
}): Promise<McpResponse>;
