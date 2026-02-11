import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const assignIssueDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            issueKeys: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            assigneeDisplayName: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function assignIssueHandler(jira: Version3Client, args: {
    issueKeys: string[];
    assigneeDisplayName: string;
}): Promise<McpResponse>;
