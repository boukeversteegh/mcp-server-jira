import { WikiMarkupTransformer } from "@atlaskit/editor-wikimarkup-transformer";
// @ts-ignore - known issue with defaultSchema export path in ESM
import { defaultSchema } from "@atlaskit/adf-schema/dist/cjs/schema/default-schema.js";
import { markdownToAdf } from "marklassian";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const wikiTransformer = new WikiMarkupTransformer(defaultSchema);

export type DescriptionFormat = "plain" | "wiki" | "markdown" | "adf";

/**
 * Conventional file extensions per content format. Markdown uses .md, Jira wiki markup
 * has no registered extension so the community conventions .wiki / .jira are accepted,
 * and ADF is plain JSON.
 */
const EXTENSION_FORMATS: Record<string, DescriptionFormat> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".wiki": "wiki",
  ".jira": "wiki",
  ".json": "adf",
  ".adf": "adf",
  ".txt": "plain",
  ".text": "plain",
};

export function formatFromExtension(filePath: string): DescriptionFormat | null {
  return EXTENSION_FORMATS[extname(filePath).toLowerCase()] ?? null;
}

export const FILE_PATH_HINT =
  "Path to a local file (absolute, or relative to the server's working directory) whose contents are used as the text. " +
  "Use this instead of passing the text inline to iterate on long content: edit the file and re-send. " +
  "The format is inferred from the extension (.md/.markdown = markdown, .wiki/.jira = wiki, .json/.adf = adf, .txt = plain) " +
  "unless it is given explicitly.";

/**
 * Resolve content that may be supplied inline or via a file. Exactly one of the two must
 * be present. Returns either the resolved text plus the format to parse it with, or a
 * user-facing error message.
 */
export async function resolveContent(opts: {
  inline?: string | undefined;
  filePath?: string | undefined;
  format?: DescriptionFormat | undefined;
  /** Name of the inline argument, used in error messages, e.g. "description". */
  inlineArgName: string;
}): Promise<{ text: string; format: DescriptionFormat; source: string } | { error: string }> {
  const { inline, filePath, format, inlineArgName } = opts;

  if (typeof inline === "string" && filePath) {
    return { error: `Error: pass either ${inlineArgName} or filePath, not both.` };
  }
  if (typeof inline !== "string" && !filePath) {
    return { error: `Error: ${inlineArgName} or filePath is required.` };
  }

  if (!filePath) {
    return { text: inline as string, format: format ?? "plain", source: "inline text" };
  }

  const resolved = resolve(filePath);
  const inferred = formatFromExtension(filePath);
  if (!format && !inferred) {
    return {
      error:
        `Error: cannot infer the format from "${filePath}". Use a conventional extension ` +
        `(.md, .wiki, .json for ADF, .txt) or pass the format explicitly.`,
    };
  }

  let text: string;
  try {
    text = await readFile(resolved, "utf8");
  } catch (e: any) {
    const reason = e?.code === "ENOENT" ? "file not found" : (e?.message ?? String(e));
    return { error: `Error reading ${resolved}: ${reason}` };
  }

  if (text.trim().length === 0) {
    return { error: `Error: ${resolved} is empty. Refusing to replace existing content with nothing.` };
  }

  return { text, format: format ?? inferred!, source: resolved };
}

export type McpText = { type: "text"; text: string };
export type McpResponse = {
  content: McpText[];
  _meta?: Record<string, unknown>;
  isError?: boolean;
};

export function respond(text: string): McpResponse {
  return { content: [{ type: "text", text }], _meta: {} };
}

export function fail(text: string): McpResponse {
  return { content: [{ type: "text", text }], isError: true, _meta: {} };
}

export function validateArray(name: string, value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) {
    return `Error: ${name} must be a non-empty array`;
  }
  return null;
}

export function validateString(name: string, value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return `Error: ${name} must be a non-empty string`;
  }
  return null;
}

// Uniform Jira error rendering (includes axios-like response.data if present)
export function formatJiraError(prefix: string, error: any): string {
  const base = `${prefix}: ${error?.message ?? String(error)}`;
  const data =
    error?.response?.data
      ? typeof error.response.data === "object"
        ? JSON.stringify(error.response.data, null, 2)
        : String(error.response.data)
      : null;
  return data ? `${base}\n\nResponse data:\n${data}` : base;
}

// Helper wrapper to simplify try/catch in handlers
export async function withJiraError(
  action: () => Promise<McpResponse>,
  prefix = "Error"
): Promise<McpResponse> {
  try {
    return await action();
  } catch (e: any) {
    return fail(formatJiraError(prefix, e));
  }
}

/**
 * Recursively remove null values from an object (Jira API rejects nulls in ADF)
 */
function stripNulls(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(stripNulls);
  }
  if (obj !== null && typeof obj === "object") {
    const result: any = {};
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
export function buildADF(text: string, format: DescriptionFormat = "plain"): object {
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
      if (!adf.version) adf.version = 1;
      return adf;
    }
    case "adf": {
      const parsed = JSON.parse(text);
      // Ensure version is set
      if (!parsed.version) parsed.version = 1;
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