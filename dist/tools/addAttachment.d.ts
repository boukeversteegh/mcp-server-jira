import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const addAttachmentDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKey: {
                type: string;
                description: string;
            };
            filePaths: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
        };
        required: string[];
    };
};
export declare function addAttachmentHandler(jira: Version3Client, args: {
    issueKey: string;
    filePaths: string[];
}): Promise<McpResponse>;
