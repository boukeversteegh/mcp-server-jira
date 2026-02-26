import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
export declare const updateCommentDefinition: {
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
            comment: {
                type: string;
                description: string;
            };
            commentFormat: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
};
export declare function updateCommentHandler(jira: Version3Client, args: {
    issueKey: string;
    commentId: string;
    comment: string;
    commentFormat?: DescriptionFormat;
}): Promise<McpResponse>;
