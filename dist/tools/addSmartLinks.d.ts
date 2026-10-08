import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const addSmartLinksDefinition: {
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
            dryRun: {
                type: string;
                description: string;
            };
            projects: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            prRepo: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function addSmartLinksHandler(jira: Version3Client, args: {
    issueKey: string;
    commentId?: string;
    dryRun?: boolean;
    projects?: string[];
    prRepo?: string;
}): Promise<McpResponse>;
