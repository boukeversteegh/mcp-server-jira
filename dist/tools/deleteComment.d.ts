import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const deleteCommentDefinition: {
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
        };
        required: string[];
    };
};
export declare function deleteCommentHandler(jira: Version3Client, args: {
    issueKey: string;
    commentId: string;
}): Promise<McpResponse>;
