import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const getAttachmentDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKey: {
                type: string;
                description: string;
            };
            attachmentId: {
                type: string;
                description: string;
            };
            saveTo: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function getAttachmentHandler(jira: Version3Client, args: {
    issueKey: string;
    attachmentId?: string;
    saveTo?: string;
}): Promise<McpResponse>;
