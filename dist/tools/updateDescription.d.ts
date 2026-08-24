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
            filePath: {
                type: string;
                description: string;
            };
            expectedVersion: {
                type: string;
                description: string;
            };
            force: {
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
    description?: string;
    filePath?: string;
    descriptionFormat?: DescriptionFormat;
    expectedVersion?: string;
    force?: boolean;
}): Promise<McpResponse>;
