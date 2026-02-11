import { Version3Client } from "jira.js";
import type { DescriptionFormat, McpResponse } from "../utils.js";
export declare const addCommentDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKey: {
                type: string;
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
export declare function addCommentHandler(jira: Version3Client, args: {
    issueKey: string;
    comment: string;
    commentFormat?: DescriptionFormat;
}): Promise<McpResponse>;
