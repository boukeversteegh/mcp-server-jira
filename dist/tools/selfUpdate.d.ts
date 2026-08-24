import type { McpResponse } from "../utils.js";
export declare const selfUpdateDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {};
    };
};
export declare function selfUpdateHandler(): Promise<McpResponse>;
