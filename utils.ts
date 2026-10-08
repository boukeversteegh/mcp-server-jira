import { WikiMarkupTransformer } from "@atlaskit/editor-wikimarkup-transformer";
// @ts-ignore - known issue with defaultSchema export path in ESM
import { defaultSchema } from "@atlaskit/adf-schema/dist/cjs/schema/default-schema.js";
import { markdownToAdf } from "marklassian";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { addSmartLinks, smartLinkOptionsFromEnv, type SmartLinkReport } from "./shared/smartLinks.js";

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
  /** When true, supplying neither is allowed and yields empty text (e.g. ticket creation). */
  optional?: boolean | undefined;
}): Promise<{ text: string; format: DescriptionFormat; source: string } | { error: string }> {
  const { inline, filePath, format, inlineArgName, optional = false } = opts;

  if (typeof inline === "string" && filePath) {
    return { error: `Error: pass either ${inlineArgName} or filePath, not both.` };
  }
  if (typeof inline !== "string" && !filePath) {
    if (optional) return { text: "", format: format ?? "plain", source: "" };
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
 * ADF node types whose `content` array must contain at least one block node. Jira's
 * validator rejects the document outright when one of these is empty, with a generic
 * `400 INVALID_INPUT` naming the *field* (e.g. `errors.comment`) rather than the node,
 * which makes the real cause very hard to spot.
 *
 * The markdown converter (marklassian) guards `tableCell` but not `tableHeader`,
 * `listItem` or `blockquote`, so a markdown table with an empty header cell
 * (`| | Count | Tenants |`) produces `{ type: "tableHeader", content: [] }` and the
 * whole comment is refused. An empty paragraph is the canonical valid filler.
 */
const ADF_NEEDS_BLOCK_CONTENT = new Set(["tableHeader", "tableCell", "listItem", "blockquote", "panel"]);

/**
 * Make converter output safe for the Jira API:
 *  - drop empty text nodes (`{ type: "text", text: "" }`), which ADF forbids outright
 *    (an empty fenced code block produces one);
 *  - give containers that require block content an empty paragraph when they ended up
 *    with nothing, instead of an empty `content` array.
 *
 * Returns null when the node itself has to disappear.
 */
function sanitizeAdfNode(node: any): any | null {
  if (node === null || typeof node !== "object") return node;

  if (node.type === "text" && !node.text) return null;

  if (Array.isArray(node.content)) {
    node.content = node.content.map(sanitizeAdfNode).filter((n: any) => n !== null);
  }

  if (ADF_NEEDS_BLOCK_CONTENT.has(node.type) && !node.content?.length) {
    node.content = [{ type: "paragraph", content: [] }];
  }

  return node;
}

/** Apply {@link sanitizeAdfNode} to a whole document, in place. */
export function sanitizeAdf<T>(doc: T): T {
  sanitizeAdfNode(doc);
  return doc;
}

/**
 * Build ADF (Atlassian Document Format) from text.
 *
 * @param text - The text content to convert
 * @param format - The format of the input text:
 *   - "plain" (default): Wraps text in a single paragraph
 *   - "wiki": Parses Jira wiki markup (h2., {code}, *bold*, etc.)
 *   - "markdown": Parses Markdown (## headings, **bold**, ```code```, etc.), with links to
 *     issues and Confluence pages on this Jira site written as smart-link cards
 *   - "adf": Expects text to be JSON string of ADF, parses and returns it
 */
export function buildADF(text: string, format: DescriptionFormat = "plain"): object {
  return buildADFWithReport(text, format).adf;
}

/**
 * {@link buildADF}, plus what the smart-link pass changed, so a tool can tell the caller which
 * keys did not become a card. The report is null for formats the pass does not run on: raw ADF
 * is uploaded exactly as given.
 */
export function buildADFWithReport(
  text: string,
  format: DescriptionFormat = "plain"
): { adf: object; smartLinks: SmartLinkReport | null } {
  if (format === "markdown") {
    const adf = markdownToAdf(text);
    // Ensure version is set
    if (!adf.version) adf.version = 1;
    // A markdown link to an issue is an ordinary link; Jira only shows a card for an
    // inlineCard node.
    const options = smartLinkOptionsFromEnv();
    const smartLinks = options ? addSmartLinks(adf, options) : null;
    // Repair nodes the converter can leave empty (e.g. an empty table header cell),
    // which Jira would otherwise reject with a bare 400 INVALID_INPUT.
    return { adf: sanitizeAdf(adf), smartLinks };
  }
  return { adf: buildOtherADF(text, format), smartLinks: null };
}

function buildOtherADF(text: string, format: Exclude<DescriptionFormat, "markdown">): object {
  switch (format) {
    case "wiki": {
      const pmNode = wikiTransformer.parse(text);
      const adf = pmNode.toJSON();
      // Ensure version is set and strip nulls (Jira rejects them)
      return stripNulls({ ...adf, version: 1 });
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