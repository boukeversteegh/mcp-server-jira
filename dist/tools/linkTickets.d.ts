import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const linkIssuesDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            inwardIssueKeys: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            outwardIssueKeys: {
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
export declare function linkIssuesHandler(jira: Version3Client, args: {
    inwardIssueKeys: string[];
    outwardIssueKeys: string[];
}): Promise<McpResponse>;
