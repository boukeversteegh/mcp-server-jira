import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const searchIssuesDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            jql: {
                type: string;
                description: string;
            };
            projectKey: {
                type: string;
                description: string;
            };
            issueType: {
                type: string;
                description: string;
            };
            statusCategory: {
                type: string;
                description: string;
            };
            maxResults: {
                type: string;
                description: string;
            };
            nextPageToken: {
                type: string;
                description: string;
            };
        };
    };
};
export declare function searchIssuesHandler(jira: Version3Client, args: {
    jql?: string;
    projectKey?: string;
    issueType?: string;
    statusCategory?: string;
    maxResults?: number;
    nextPageToken?: string;
}): Promise<McpResponse>;
