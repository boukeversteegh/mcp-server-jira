import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
export declare const createSubTicketDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            parentKey: {
                type: string;
            };
            summary: {
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
            descriptionFormat: {
                type: string;
                enum: string[];
                description: string;
            };
            issueType: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function createSubTicketCore(jira: Version3Client, args: {
    parentKey: string;
    summary: string;
    description?: string;
    descriptionFormat?: DescriptionFormat;
    issueType?: string;
    /** Where the description came from, for the result message (e.g. a file path). */
    descriptionSource?: string | undefined;
}): Promise<McpResponse>;
export declare function createSubTicketHandler(jira: Version3Client, args: {
    parentKey: string;
    summary: string;
    description?: string;
    filePath?: string;
    descriptionFormat?: DescriptionFormat;
    issueType?: string;
}): Promise<McpResponse>;
