import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const transitionIssuesDefinition: {
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
            transitionId: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function transitionIssuesHandler(jira: Version3Client, args: {
    issueKeys: string[];
    transitionId: string;
}): Promise<McpResponse>;
