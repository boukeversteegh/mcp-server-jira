/**
 * Smart-links: Jira issues and Confluence pages shown as a card (key, summary, live status)
 * instead of a plain link.
 *
 * A card is an `inlineCard` node holding nothing but a URL — Jira resolves the summary and the
 * status chip when it renders — so turning text into cards is a pure transformation of the
 * document and needs no lookups. Markdown and wiki links never produce one on their own: a link
 * to an issue stays an ordinary `link` mark, however it is written.
 */
export type SmartLinkOptions = {
    /** Host of this server's Jira site, e.g. `your-domain.atlassian.net`. */
    site: string;
    /** Projects whose bare issue keys (`ABC-123`) become cards. Empty: bare keys are left alone. */
    projects: string[];
    /** `owner/repo`: a bare `#1234` becomes a link to that repository's pull request. */
    prRepo?: string | undefined;
};
export type SmartLinkChange = {
    kind: "link-to-card";
    url: string;
    text: string;
} | {
    kind: "url-to-card";
    url: string;
} | {
    kind: "key-to-card";
    key: string;
    url: string;
} | {
    kind: "url-to-link";
    url: string;
} | {
    kind: "pr-to-link";
    text: string;
    url: string;
};
export type SmartLinkReport = {
    changes: SmartLinkChange[];
    /** Keys left alone because a card in the middle of a word reads badly. */
    skipped: {
        key: string;
        context: string;
    }[];
};
/** Project keys from a comma- or space-separated list, or the first entry that is not one. */
export declare function parseProjects(list: string | string[]): {
    projects: string[];
} | {
    error: string;
};
/**
 * Options from the server's environment: the site from `JIRA_HOST`, and the projects whose bare
 * keys are converted from `JIRA_SMARTLINK_PROJECTS` (e.g. `ABC,XYZ`). Bare-key conversion is
 * opt-in because a key is just text until someone says which projects are real.
 */
export declare function smartLinkOptionsFromEnv(env?: NodeJS.ProcessEnv): SmartLinkOptions | null;
/** Matches a URL that Jira renders as a card: an issue or a Confluence page on this site. */
export declare function smartLinkPattern(site: string): RegExp;
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
export declare function addSmartLinks(doc: any, options: SmartLinkOptions): SmartLinkReport;
/** One line per change and per skipped key, for a tool result. */
export declare function formatSmartLinkReport(report: SmartLinkReport): string[];
/** Short summary for tools that write new content; empty when the pass changed nothing. */
export declare function summarizeSmartLinks(report: SmartLinkReport | null): string;
