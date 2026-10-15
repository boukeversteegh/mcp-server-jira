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
            linkType: {
                type: string;
                description: string;
            };
            allowReciprocal: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
type LinkType = {
    id?: string;
    name?: string;
    inward?: string;
    outward?: string;
};
/**
 * Resolve a link type by its name, its name without the numeric prefix some sites use
 * ("3. Blocks" -> "blocks"), or its inward or outward description. Case-insensitive.
 */
export declare function findLinkType<T extends LinkType>(available: T[], linkType: string): T | undefined;
export declare function listLinkTypes(available: LinkType[]): string;
/**
 * How Jira's link fields map to the relation the UI shows (checked against the Jira UI):
 *  - In a link itself (the create request body and GET /issueLink/{id}), `inwardIssue` is the
 *    issue the *outward* description is about: { inwardIssue: A, outwardIssue: B } on
 *    "Blocks" is shown as "A blocks B".
 *  - In an issue's own `issuelinks`, only the other end appears, under that end's field:
 *    on issue X, `outwardIssue: Y` reads "X <outward> Y" and `inwardIssue: Y` reads
 *    "X <inward> Y".
 */
export declare function linkRelationFor(link: {
    inwardIssue?: unknown;
    outwardIssue?: unknown;
    type?: LinkType;
}): string | undefined;
export declare function linkIssuesHandler(jira: Version3Client, args: {
    inwardIssueKeys: string[];
    outwardIssueKeys: string[];
    linkType?: string;
    allowReciprocal?: boolean;
}): Promise<McpResponse>;
export {};
