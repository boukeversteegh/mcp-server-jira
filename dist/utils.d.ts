export type DescriptionFormat = "plain" | "wiki" | "markdown" | "adf";
export type McpText = {
    type: "text";
    text: string;
};
export type McpResponse = {
    content: McpText[];
    _meta?: Record<string, unknown>;
    isError?: boolean;
};
export declare function respond(text: string): McpResponse;
export declare function fail(text: string): McpResponse;
export declare function validateArray(name: string, value: unknown): string | null;
export declare function validateString(name: string, value: unknown): string | null;
export declare function formatJiraError(prefix: string, error: any): string;
export declare function withJiraError(action: () => Promise<McpResponse>, prefix?: string): Promise<McpResponse>;
/**
 * Build ADF (Atlassian Document Format) from text.
 *
 * @param text - The text content to convert
 * @param format - The format of the input text:
 *   - "plain" (default): Wraps text in a single paragraph
 *   - "wiki": Parses Jira wiki markup (h2., {code}, *bold*, etc.)
 *   - "markdown": Parses Markdown (## headings, **bold**, ```code```, etc.)
 *   - "adf": Expects text to be JSON string of ADF, parses and returns it
 */
export declare function buildADF(text: string, format?: DescriptionFormat): object;
