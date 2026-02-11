import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const unlinkIssuesDefinition: {
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
            targetKeys: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            linkType: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function unlinkIssuesHandler(jira: Version3Client, args: {
    issueKeys: string[];
    targetKeys?: string[];
    linkType?: string;
}): Promise<McpResponse>;
