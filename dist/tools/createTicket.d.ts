import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
export declare const createTicketDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            projectKey: {
                type: string;
            };
            summary: {
                type: string;
            };
            description: {
                type: string;
                description: string;
            };
            descriptionFormat: {
                type: string;
                enum: string[];
                description: string;
            };
            issueType: {
                type: string;
                description: string;
            };
            parentKey: {
                type: string;
                description: string;
            };
            fields: {
                type: string;
                description: string;
                additionalProperties: boolean;
            };
        };
        required: string[];
    };
};
export declare function createTicketHandler(jira: Version3Client, customFieldsMap: Map<string, string>, args: {
    projectKey: string;
    summary: string;
    description?: string;
    descriptionFormat?: DescriptionFormat;
    issueType?: string;
    parentKey?: string;
    fields?: Record<string, any>;
}): Promise<McpResponse>;
