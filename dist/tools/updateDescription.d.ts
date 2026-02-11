import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
export declare const updateDescriptionDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKey: {
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
        };
        required: string[];
    };
};
export declare function updateDescriptionHandler(jira: Version3Client, args: {
    issueKey: string;
    description: string;
    descriptionFormat?: DescriptionFormat;
}): Promise<McpResponse>;
