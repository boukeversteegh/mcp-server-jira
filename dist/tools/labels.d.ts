import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
export declare const labelsDefinition: {
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
            labels: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            mode: {
                type: string;
                enum: string[];
                description: string;
            };
        };
        required: string[];
    };
};
export declare function labelsHandler(jira: Version3Client, args: {
    issueKeys: string[];
    labels: string[];
    mode?: "add" | "remove" | "set";
}): Promise<McpResponse>;
