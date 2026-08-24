export type DescriptionFormat = "plain" | "wiki" | "markdown" | "adf";
export declare function formatFromExtension(filePath: string): DescriptionFormat | null;
export declare const FILE_PATH_HINT: string;
/**
 * Resolve content that may be supplied inline or via a file. Exactly one of the two must
 * be present. Returns either the resolved text plus the format to parse it with, or a
 * user-facing error message.
 */
export declare function resolveContent(opts: {
    inline?: string | undefined;
    filePath?: string | undefined;
    format?: DescriptionFormat | undefined;
    /** Name of the inline argument, used in error messages, e.g. "description". */
    inlineArgName: string;
    /** When true, supplying neither is allowed and yields empty text (e.g. ticket creation). */
    optional?: boolean | undefined;
}): Promise<{
    text: string;
    format: DescriptionFormat;
    source: string;
} | {
    error: string;
}>;
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
