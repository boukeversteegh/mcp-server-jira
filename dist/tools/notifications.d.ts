import type { McpResponse } from "../utils.js";
import { type GraphqlClient } from "../shared/atlassianGraphql.js";
export declare const notificationsDefinition: {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: {
            ids: {
                type: string;
                items: {
                    type: string;
                };
                description: string;
            };
            since: {
                type: string;
                description: string;
            };
            until: {
                type: string;
                description: string;
            };
            limit: {
                type: string;
                description: string;
            };
            unreadOnly: {
                type: string;
                description: string;
            };
            category: {
                type: string;
                enum: string[];
                description: string;
            };
            product: {
                type: string;
                description: string;
            };
            markAsRead: {
                type: string;
                description: string;
            };
        };
    };
};
export type NotificationsArgs = {
    ids?: string[];
    since?: string;
    until?: string;
    limit?: number;
    unreadOnly?: boolean;
    category?: "direct" | "watching";
    product?: string;
    markAsRead?: boolean;
};
/**
 * Parse an absolute ISO date/time or a relative duration ("24h", "7d") into an ISO timestamp.
 * Returns null when the value is neither.
 */
export declare function parseTimeFilter(value: string, now?: Date): string | null;
export declare function notificationsHandler(args: NotificationsArgs, client?: GraphqlClient, now?: Date, routingAri?: () => Promise<string>): Promise<McpResponse>;
export declare function timestampFromId(id: string): number | null;
