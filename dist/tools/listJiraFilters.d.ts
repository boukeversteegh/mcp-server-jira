import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const listJiraFiltersDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {};
    };
};
export declare function listJiraFiltersHandler(jira: Version3Client): Promise<McpResponse>;
