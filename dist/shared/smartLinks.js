// @ts-ignore - known issue with defaultSchema export path in ESM
import { defaultSchema } from "@atlaskit/adf-schema/dist/cjs/schema/default-schema.js";
const PROJECT_KEY = /^[A-Z][A-Z0-9_]+$/;
/** Project keys from a comma- or space-separated list, or the first entry that is not one. */
export function parseProjects(list) {
    const entries = (Array.isArray(list) ? list : list.split(/[\s,]+/))
        .map((p) => p.trim().toUpperCase())
        .filter(Boolean);
    const invalid = entries.find((p) => !PROJECT_KEY.test(p));
    if (invalid)
        return { error: `"${invalid}" is not a Jira project key` };
    return { projects: [...new Set(entries)] };
}
/**
 * Options from the server's environment: the site from `JIRA_HOST`, and the projects whose bare
 * keys are converted from `JIRA_SMARTLINK_PROJECTS` (e.g. `ABC,XYZ`). Bare-key conversion is
 * opt-in because a key is just text until someone says which projects are real.
 */
export function smartLinkOptionsFromEnv(env = process.env) {
    const site = siteOf(env.JIRA_HOST);
    if (!site)
        return null;
    const parsed = parseProjects(env.JIRA_SMARTLINK_PROJECTS ?? "");
    if ("error" in parsed) {
        console.error(`Ignoring JIRA_SMARTLINK_PROJECTS: ${parsed.error}`);
        return { site, projects: [] };
    }
    return { site, projects: parsed.projects };
}
function siteOf(host) {
    if (!host)
        return null;
    try {
        return new URL(/^https?:\/\//i.test(host) ? host : `https://${host}`).host;
    }
    catch {
        return null;
    }
}
function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/** Matches a URL that Jira renders as a card: an issue or a Confluence page on this site. */
export function smartLinkPattern(site) {
    return new RegExp(`^https?://${escapeRegExp(site)}/(browse/[A-Z][A-Z0-9_]+-\\d+(\\?\\S*)?|wiki/(spaces|pages)/\\S+)$`);
}
/**
 * Whether a node may hold an `inlineCard`. Text elsewhere is left alone: a code block, for one,
 * holds text only, so a key in a fenced code sample must stay text.
 */
const acceptsCardCache = new Map();
function acceptsInlineCard(type) {
    let accepts = acceptsCardCache.get(type);
    if (accepts === undefined) {
        const nodeType = defaultSchema.nodes[type];
        accepts = !!nodeType && nodeType.contentMatch.matchType(defaultSchema.nodes.inlineCard) !== null;
        acceptsCardCache.set(type, accepts);
    }
    return accepts;
}
// A key glued to a word, before or after: "hotfix-ABC-1", "ABC-1-klasse", "ABC-1x", "ABC-1_x".
const GLUED_BEFORE = /[\p{L}\d]-?$/u;
const GLUED_AFTER = /^(-?[\p{L}\d]|_)/u;
/**
 * Turn mentions of issues and Confluence pages into cards, in place:
 *  - a link to an issue or page on this site → card (its text goes: the card shows the summary);
 *  - such a URL as bare text → card;
 *  - a bare key of one of `options.projects` → card, unless it is glued to a word;
 *  - any other bare URL → the same text, made a link;
 *  - with `options.prRepo`, a bare `#1234` → a link to that pull request.
 *
 * Inline code, code blocks and keys inside a URL are left alone, and so is every node other than
 * text: the rest of the document round-trips untouched.
 */
export function addSmartLinks(doc, options) {
    const tokens = [String.raw `https?:\/\/[^\s<>"]*[^\s<>".,;:!?)\]]`];
    // No \b after the number: a key with a letter right after it is reported as glued, not skipped silently.
    if (options.projects.length)
        tokens.push(String.raw `\b(?:${options.projects.join("|")})-\d+(?!\d)`);
    if (options.prRepo)
        tokens.push(String.raw `(?<![\w&])#\d{3,6}\b`);
    const pattern = smartLinkPattern(options.site);
    const ctx = {
        options,
        isSmart: (url) => pattern.test(url),
        // A URL first, so a key inside a URL is never matched on its own.
        token: new RegExp(tokens.join("|"), "g"),
        report: { changes: [], skipped: [] },
        created: new WeakSet(),
    };
    patchChildren(doc, ctx);
    return ctx.report;
}
function patchChildren(node, ctx) {
    if (!node || typeof node !== "object" || !Array.isArray(node.content))
        return;
    const patchable = acceptsInlineCard(node.type);
    const out = [];
    for (const child of node.content) {
        if (!patchable || child?.type !== "text") {
            patchChildren(child, ctx);
            out.push(child);
            continue;
        }
        const marks = child.marks ?? [];
        if (marks.some((m) => m.type === "code")) {
            out.push(child);
            continue;
        }
        const link = marks.find((m) => m.type === "link");
        if (link) {
            const href = link.attrs?.href;
            if (typeof href !== "string" || !ctx.isSmart(href)) {
                out.push(child);
                continue;
            }
            const prev = out[out.length - 1];
            if (prev && ctx.created.has(prev) && prev.attrs.url === href) {
                // The rest of a link whose text was split over several nodes (bold inside, say).
                const change = ctx.report.changes[ctx.report.changes.length - 1];
                if (change?.kind === "link-to-card")
                    change.text += child.text ?? "";
                continue;
            }
            out.push(card(href, ctx));
            ctx.report.changes.push({ kind: "link-to-card", url: href, text: child.text ?? "" });
            continue;
        }
        out.push(...patchText(child, ctx));
    }
    node.content = out;
}
function patchText(node, ctx) {
    const text = node.text ?? "";
    const parts = [];
    let last = 0;
    for (const match of text.matchAll(ctx.token)) {
        const token = match[0];
        const start = match.index;
        let replacement = null;
        if (/^https?:/.test(token)) {
            if (ctx.isSmart(token)) {
                replacement = card(token, ctx);
                ctx.report.changes.push({ kind: "url-to-card", url: token });
            }
            else {
                replacement = withLink(node, token, token);
                ctx.report.changes.push({ kind: "url-to-link", url: token });
            }
        }
        else if (token.startsWith("#")) {
            const url = `https://github.com/${ctx.options.prRepo}/pull/${token.slice(1)}`;
            replacement = withLink(node, token, url);
            ctx.report.changes.push({ kind: "pr-to-link", text: token, url });
        }
        else if (GLUED_BEFORE.test(text.slice(0, start)) || GLUED_AFTER.test(text.slice(start + token.length))) {
            ctx.report.skipped.push({ key: token, context: text.slice(Math.max(0, start - 40), start + token.length + 40) });
        }
        else {
            const url = `https://${ctx.options.site}/browse/${token}`;
            replacement = card(url, ctx);
            ctx.report.changes.push({ kind: "key-to-card", key: token, url });
        }
        if (replacement) {
            if (start > last)
                parts.push({ ...node, text: text.slice(last, start) });
            parts.push(replacement);
            last = start + token.length;
        }
    }
    if (!parts.length)
        return [node];
    if (last < text.length)
        parts.push({ ...node, text: text.slice(last) });
    return parts;
}
function card(url, ctx) {
    const node = { type: "inlineCard", attrs: { url } };
    ctx.created.add(node);
    return node;
}
function withLink(node, text, href) {
    return { ...node, text, marks: [...(node.marks ?? []), { type: "link", attrs: { href } }] };
}
/** One line per change and per skipped key, for a tool result. */
export function formatSmartLinkReport(report) {
    const lines = report.changes.map((c) => {
        switch (c.kind) {
            case "link-to-card":
                return `link -> card   ${c.url}   (link text was ${JSON.stringify(c.text)})`;
            case "url-to-card":
                return `url  -> card   ${c.url}`;
            case "key-to-card":
                return `key  -> card   ${c.key}`;
            case "url-to-link":
                return `url  -> link   ${c.url}`;
            case "pr-to-link":
                return `#nr  -> link   ${c.text} -> ${c.url}`;
        }
    });
    for (const s of report.skipped) {
        lines.push(`SKIPPED        ${s.key} is glued to a word in ${JSON.stringify(s.context)} — rephrase to get a card`);
    }
    return lines;
}
/** Short summary for tools that write new content; empty when the pass changed nothing. */
export function summarizeSmartLinks(report) {
    if (!report)
        return "";
    const cards = report.changes.filter((c) => c.kind.endsWith("-to-card")).length;
    const lines = cards ? [`Smart-links: ${cards} Jira/Confluence link(s) written as a card.`] : [];
    for (const s of report.skipped) {
        lines.push(`Not a card: ${s.key} is glued to a word in ${JSON.stringify(s.context)} — rephrase so the key stands on its own to get one.`);
    }
    return lines.length ? `\n${lines.join("\n")}` : "";
}
