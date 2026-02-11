import { WikiMarkupTransformer } from "@atlaskit/editor-wikimarkup-transformer";
// @ts-ignore - known issue with defaultSchema export path in ESM
import { defaultSchema } from "@atlaskit/adf-schema/dist/cjs/schema/default-schema.js";
import { markdownToAdf } from "marklassian";
const wikiTransformer = new WikiMarkupTransformer(defaultSchema);
export function respond(text) {
    return { content: [{ type: "text", text }], _meta: {} };
}
export function fail(text) {
    return { content: [{ type: "text", text }], isError: true, _meta: {} };
}
export function validateArray(name, value) {
    if (!Array.isArray(value) || value.length === 0) {
        return `Error: ${name} must be a non-empty array`;
    }
    return null;
}
export function validateString(name, value) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return `Error: ${name} must be a non-empty string`;
    }
    return null;
}
// Uniform Jira error rendering (includes axios-like response.data if present)
export function formatJiraError(prefix, error) {
    const base = `${prefix}: ${error?.message ?? String(error)}`;
    const data = error?.response?.data
        ? typeof error.response.data === "object"
            ? JSON.stringify(error.response.data, null, 2)
            : String(error.response.data)
        : null;
    return data ? `${base}\n\nResponse data:\n${data}` : base;
}
// Helper wrapper to simplify try/catch in handlers
export async function withJiraError(action, prefix = "Error") {
    try {
        return await action();
    }
    catch (e) {
        return fail(formatJiraError(prefix, e));
    }
}
/**
 * Recursively remove null values from an object (Jira API rejects nulls in ADF)
 */
function stripNulls(obj) {
    if (Array.isArray(obj)) {
        return obj.map(stripNulls);
    }
    if (obj !== null && typeof obj === "object") {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (value !== null) {
                result[key] = stripNulls(value);
            }
        }
        return result;
    }
    return obj;
}
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
export function buildADF(text, format = "plain") {
    switch (format) {
        case "wiki": {
            const pmNode = wikiTransformer.parse(text);
            const adf = pmNode.toJSON();
            // Ensure version is set and strip nulls (Jira rejects them)
            return stripNulls({ ...adf, version: 1 });
        }
        case "markdown": {
            const adf = markdownToAdf(text);
            // Ensure version is set
            if (!adf.version)
                adf.version = 1;
            return adf;
        }
        case "adf": {
            const parsed = JSON.parse(text);
            // Ensure version is set
            if (!parsed.version)
                parsed.version = 1;
            return parsed;
        }
        case "plain":
        default:
            return {
                type: "doc",
                version: 1,
                content: [
                    {
                        type: "paragraph",
                        content: [{ type: "text", text }],
                    },
                ],
            };
    }
}
