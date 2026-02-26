// ── Inline helpers ────────────────────────────────────────────────────────────
function applyMarks(text, marks) {
    let result = text;
    for (const mark of marks) {
        switch (mark.type) {
            case "strong":
                result = `**${result}**`;
                break;
            case "em":
                result = `_${result}_`;
                break;
            case "strike":
                result = `~~${result}~~`;
                break;
            case "code":
                result = `\`${result}\``;
                break;
            case "underline":
                result = `<u>${result}</u>`;
                break;
            case "link":
                result = `[${result}](${mark.attrs?.href || ""})`;
                break;
            case "subsup":
                result = mark.attrs?.type === "sub" ? `<sub>${result}</sub>` : `<sup>${result}</sup>`;
                break;
            case "textColor":
                // No markdown equivalent — keep text as-is
                break;
            case "annotation":
                // Annotations are Confluence-side only, ignore
                break;
            default:
                result += ` <!-- ADF mark "${mark.type}" could not be converted -->`;
        }
    }
    return result;
}
function convertInlineToMarkdown(node) {
    if (!node)
        return "";
    switch (node.type) {
        case "text": {
            const text = node.text || "";
            return node.marks?.length ? applyMarks(text, node.marks) : text;
        }
        case "hardBreak":
            return "\n";
        case "mention":
            return node.attrs?.text || "@unknown";
        case "emoji":
            return node.attrs?.shortName || node.attrs?.text || "";
        case "inlineCard":
            return node.attrs?.url || "";
        case "status":
            return `[${node.attrs?.text || "STATUS"}]`;
        case "date": {
            const ts = node.attrs?.timestamp;
            return ts ? new Date(Number(ts)).toLocaleDateString() : "";
        }
        case "placeholder":
            return node.attrs?.text || "";
        default:
            return `<!-- ADF inline "${node.type}" could not be converted: ${JSON.stringify(node)} -->`;
    }
}
function inlineContent(nodes) {
    return (nodes || []).map(convertInlineToMarkdown).join("");
}
// ── List helpers ──────────────────────────────────────────────────────────────
function convertListItem(item, depth, bullet) {
    const indent = "  ".repeat(depth);
    if (!item.content)
        return `${indent}${bullet}\n`;
    const [first, ...rest] = item.content;
    let text = "";
    if (first?.type === "paragraph") {
        text = inlineContent(first.content || []).trim();
    }
    else {
        text = convertBlockToMarkdown(first, depth).trim();
    }
    let result = `${indent}${bullet} ${text}\n`;
    for (const child of rest) {
        result += convertBlockToMarkdown(child, depth + 1);
    }
    return result;
}
// ── Table helper ──────────────────────────────────────────────────────────────
function convertTable(node) {
    const rows = node.content || [];
    if (rows.length === 0)
        return "";
    const rendered = rows.map((row) => (row.content || []).map((cell) => (cell.content || [])
        .map((c) => convertBlockToMarkdown(c, 0))
        .join("")
        .trim()
        .replace(/\n+/g, " ")));
    const colCount = Math.max(...rendered.map((r) => r.length));
    const separator = `| ${Array(colCount).fill("---").join(" | ")} |`;
    const lines = rendered.map((cells) => `| ${cells.join(" | ")} |`);
    lines.splice(1, 0, separator);
    return lines.join("\n") + "\n\n";
}
// ── Block converter ───────────────────────────────────────────────────────────
function convertBlockToMarkdown(node, depth = 0) {
    if (!node)
        return "";
    if (typeof node === "string")
        return node;
    switch (node.type) {
        case "doc":
            return (node.content || [])
                .map((c) => convertBlockToMarkdown(c, depth))
                .join("")
                .trim();
        case "paragraph": {
            if (!node.content)
                return "";
            const text = inlineContent(node.content).trim();
            return text ? `${text}\n\n` : "";
        }
        case "heading": {
            const level = Math.min(Math.max(node.attrs?.level || 1, 1), 6);
            const text = inlineContent(node.content || []);
            return `${"#".repeat(level)} ${text}\n\n`;
        }
        case "bulletList":
            return ((node.content || [])
                .map((item) => convertListItem(item, depth, "-"))
                .join("") + "\n");
        case "orderedList": {
            const start = node.attrs?.order ?? 1;
            return ((node.content || [])
                .map((item, i) => convertListItem(item, depth, `${start + i}.`))
                .join("") + "\n");
        }
        case "codeBlock": {
            const lang = node.attrs?.language || "";
            const code = (node.content || []).map((c) => c.text || "").join("");
            return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
        }
        case "blockquote": {
            const inner = (node.content || [])
                .map((c) => convertBlockToMarkdown(c, depth))
                .join("")
                .trimEnd();
            return inner.split("\n").map((line) => `> ${line}`).join("\n") + "\n\n";
        }
        case "rule":
            return "---\n\n";
        case "table":
            return convertTable(node);
        case "panel": {
            const type = (node.attrs?.panelType || "info").toUpperCase();
            const inner = (node.content || [])
                .map((c) => convertBlockToMarkdown(c, depth))
                .join("")
                .trimEnd();
            const body = inner.split("\n").map((l) => `> ${l}`).join("\n");
            return `> **[${type}]**\n${body}\n\n`;
        }
        case "expand":
        case "nestedExpand": {
            const title = node.attrs?.title || "";
            const inner = (node.content || [])
                .map((c) => convertBlockToMarkdown(c, depth))
                .join("")
                .trim();
            return `**${title}**\n\n${inner}\n\n`;
        }
        case "taskList":
            return ((node.content || [])
                .map((item) => {
                const done = item.attrs?.state === "DONE";
                const text = inlineContent(item.content || []).trim();
                return `- [${done ? "x" : " "}] ${text}\n`;
            })
                .join("") + "\n");
        case "decisionList":
            return ((node.content || [])
                .map((item) => {
                const text = inlineContent(item.content || []).trim();
                return `- ${text}\n`;
            })
                .join("") + "\n");
        case "mediaSingle":
        case "mediaGroup":
        case "media":
            return `<!-- ADF media could not be converted: ${JSON.stringify(node.attrs || {})} -->\n\n`;
        case "blockCard":
        case "embedCard":
            return `${node.attrs?.url || ""}\n\n`;
        case "extension":
        case "bodiedExtension":
        case "inlineExtension":
            return `<!-- ADF extension "${node.attrs?.extensionKey || node.type}" could not be converted: ${JSON.stringify(node.attrs || {})} -->\n\n`;
        default: {
            // Inline nodes that ended up here (e.g. "text", "mention") — convert as inline
            if (node.type === "text" || node.type === "mention" || node.type === "emoji" ||
                node.type === "hardBreak" || node.type === "inlineCard" || node.type === "status" ||
                node.type === "date" || node.type === "placeholder") {
                return convertInlineToMarkdown(node);
            }
            // Unknown block node — try to recurse into children, but flag it
            const comment = `<!-- ADF node "${node.type}" could not be converted -->`;
            if (Array.isArray(node.content)) {
                const inner = node.content
                    .map((c) => convertBlockToMarkdown(c, depth))
                    .join("");
                return `${comment}\n${inner}`;
            }
            return `${comment}\n\n`;
        }
    }
}
// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Format a labeled section.
 * - Single-line value → "Label: value"
 * - Multi-line value  → "Label:\n  line1\n  line2"
 */
export function formatSection(label, value) {
    const trimmed = value.trim();
    if (!trimmed.includes("\n"))
        return `${label}: ${trimmed}`;
    const indented = trimmed
        .split("\n")
        .map((line) => (line.length > 0 ? `  ${line}` : ""))
        .join("\n");
    return `${label}:\n${indented}`;
}
export function convertADFToMarkdown(node) {
    if (!node)
        return "No content";
    return convertBlockToMarkdown(node).trim();
}
export function formatFieldValue(value) {
    if (value === null || value === undefined)
        return "Not set";
    if (typeof value === "object") {
        if (value.type === "doc")
            return convertADFToMarkdown(value);
        if (value.displayName)
            return value.displayName;
        if (Array.isArray(value))
            return value.map((item) => formatFieldValue(item)).join(", ");
        return JSON.stringify(value);
    }
    return String(value);
}
export function hasMeaningfulValue(value) {
    if (value === null || value === undefined)
        return false;
    const t = typeof value;
    if (t === "string")
        return value.trim().length > 0;
    if (t === "number" || t === "boolean")
        return true;
    if (Array.isArray(value))
        return value.some((item) => hasMeaningfulValue(item));
    if (t === "object") {
        if (value.type === "doc") {
            return convertADFToMarkdown(value).length > 0;
        }
        const candidateKeys = ["value", "displayName", "name", "id", "text"];
        for (const key of candidateKeys) {
            if (hasMeaningfulValue(value[key]))
                return true;
        }
        for (const key in value) {
            if (Object.prototype.hasOwnProperty.call(value, key) && hasMeaningfulValue(value[key])) {
                return true;
            }
        }
        return false;
    }
    return false;
}
