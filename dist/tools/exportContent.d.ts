import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const exportContentDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKey: {
                type: string;
            };
            commentId: {
                type: string;
                description: string;
            };
            filePath: {
                type: string;
                description: string;
            };
            format: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
};
export declare function exportContentHandler(jira: Version3Client, args: {
    issueKey: string;
    commentId?: string;
    filePath?: string;
    format?: "markdown" | "adf";
}): Promise<McpResponse>;
