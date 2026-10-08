/**
 * Tests for the smart-link pass: mentions of issues and Confluence pages on this Jira site
 * become `inlineCard` nodes, which Jira renders as a card with the summary and live status.
 *
 * Every patched document is also checked against the real Atlassian ADF schema
 * (`@atlaskit/adf-schema`), the validator the Jira API applies server-side, because a card
 * in a node that cannot hold one is refused with a bare 400 INVALID_INPUT.
 */
import { createRequire } from "node:module";
import { addSmartLinks, smartLinkOptionsFromEnv } from "../dist/shared/smartLinks.js";
import { buildADF, buildADFWithReport } from "../dist/utils.js";

// adf-schema and prosemirror-model must come from the SAME (CJS) module instance.
const require = createRequire(import.meta.url);
const { defaultSchema } = require("@atlaskit/adf-schema/dist/cjs/schema/default-schema.js");
const { Node } = require("prosemirror-model");

const SITE = "example.atlassian.net";
const BROWSE = `https://${SITE}/browse/`;
const OPTIONS = { site: SITE, projects: ["ABC", "XYZ"] };

let failures = 0;
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function check(name, run) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n  ${e.message}`);
  }
}

const text = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
const link = (href) => ({ type: "link", attrs: { href } });
const para = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", version: 1, content });
const cardOf = (url) => ({ type: "inlineCard", attrs: { url } });

function valid(adf) {
  try {
    Node.fromJSON(defaultSchema, adf).check();
  } catch (e) {
    throw new Error(`schema rejected: ${e.message}\n  ${JSON.stringify(adf)}`);
  }
}

/** Patch a single paragraph and return its content plus the report. */
function patchPara(nodes, options = OPTIONS) {
  const d = doc(para(...nodes));
  const report = addSmartLinks(d, options);
  valid(d);
  return { content: d.content[0].content, report };
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// --- bare keys -------------------------------------------------------------------------
await check("a bare key becomes a card, the text around it stays", () => {
  const { content, report } = patchPara([text("zie ABC-12 en (XYZ-13).")]);
  assert(
    same(content, [text("zie "), cardOf(BROWSE + "ABC-12"), text(" en ("), cardOf(BROWSE + "XYZ-13"), text(").")]),
    JSON.stringify(content)
  );
  assert(report.changes.length === 2 && report.changes.every((c) => c.kind === "key-to-card"), JSON.stringify(report));
});

await check("marks on the surrounding text are kept", () => {
  const { content } = patchPara([text("fix ABC-1 now", [{ type: "strong" }])]);
  assert(same(content[0], text("fix ", [{ type: "strong" }])), JSON.stringify(content));
  assert(same(content[2], text(" now", [{ type: "strong" }])), JSON.stringify(content));
});

await check("keys of other projects, and keys without configured projects, stay text", () => {
  const { content } = patchPara([text("UTF-8 and FOO-12 and ABC-1")], { site: SITE, projects: ["XYZ"] });
  assert(same(content, [text("UTF-8 and FOO-12 and ABC-1")]), JSON.stringify(content));
  const none = patchPara([text("ABC-1")], { site: SITE, projects: [] });
  assert(same(none.content, [text("ABC-1")]), JSON.stringify(none.content));
});

await check("a key glued to a word is reported, not converted", () => {
  const { content, report } = patchPara([text("de XYZ-2706-klasse incidenten, branch hotfix-ABC-1 en ABC-2x")]);
  assert(content.length === 1 && content[0].type === "text", JSON.stringify(content));
  assert(same(report.skipped.map((s) => s.key), ["XYZ-2706", "ABC-1", "ABC-2"]), JSON.stringify(report.skipped));
  assert(report.skipped[0].context.includes("XYZ-2706-klasse"), "context does not show the glued word");
  assert(report.changes.length === 0, JSON.stringify(report.changes));
});

await check("a key in inline code stays text", () => {
  const code = text("ABC-12", [{ type: "code" }]);
  const { content, report } = patchPara([code]);
  assert(same(content, [code]) && report.changes.length === 0, JSON.stringify(content));
});

await check("a key in a code block stays text (a code block cannot hold a card)", () => {
  const d = doc({ type: "codeBlock", attrs: { language: "text" }, content: [text("git checkout ABC-12\nhttps://example.com")] });
  const before = JSON.stringify(d);
  const report = addSmartLinks(d, { ...OPTIONS, prRepo: "o/r" });
  assert(JSON.stringify(d) === before, JSON.stringify(d));
  assert(report.changes.length === 0, JSON.stringify(report));
});

// --- URLs ------------------------------------------------------------------------------
await check("a key inside a URL is not matched on its own; the URL becomes a link", () => {
  const url = "https://github.com/o/r/tree/ABC-12-foo";
  const { content, report } = patchPara([text(`branch ${url} gepusht`)]);
  assert(same(content, [text("branch "), text(url, [link(url)]), text(" gepusht")]), JSON.stringify(content));
  assert(same(report.changes.map((c) => c.kind), ["url-to-link"]), JSON.stringify(report));
});

await check("trailing punctuation is not part of a URL", () => {
  const { content } = patchPara([text("zie https://github.com/o/r/pull/1, en (https://example.com/x).")]);
  assert(content[1].text === "https://github.com/o/r/pull/1", JSON.stringify(content));
  assert(content[3].text === "https://example.com/x", JSON.stringify(content));
});

await check("a bare URL of an issue or page on this site becomes a card", () => {
  const issue = `${BROWSE}ABC-1?focusedCommentId=5`;
  const page = `https://${SITE}/wiki/spaces/EDU/pages/123/Some+Page`;
  const { content } = patchPara([text(`${issue} en ${page}`)]);
  assert(same(content, [cardOf(issue), text(" en "), cardOf(page)]), JSON.stringify(content));
});

await check("an issue URL on another site is a plain link, not a card", () => {
  const other = "https://other.atlassian.net/browse/ABC-1";
  const { content } = patchPara([text(other)], { site: SITE, projects: [] });
  assert(same(content, [text(other, [link(other)])]), JSON.stringify(content));
});

// --- existing links --------------------------------------------------------------------
await check("a link to an issue on this site becomes a card and its text is dropped", () => {
  const href = `${BROWSE}ABC-1`;
  const { content, report } = patchPara([text("zie "), text("ABC-1: Export mist rijen", [link(href)])]);
  assert(same(content, [text("zie "), cardOf(href)]), JSON.stringify(content));
  assert(report.changes[0].kind === "link-to-card" && report.changes[0].text === "ABC-1: Export mist rijen", JSON.stringify(report));
});

await check("a link split over several text nodes becomes one card", () => {
  const href = `${BROWSE}ABC-1`;
  const { content, report } = patchPara([
    text("ABC-1: ", [link(href)]),
    text("vet", [{ type: "strong" }, link(href)]),
    text(" deel", [link(href)]),
    text(" daarna"),
  ]);
  assert(same(content, [cardOf(href), text(" daarna")]), JSON.stringify(content));
  assert(report.changes.length === 1 && report.changes[0].text === "ABC-1: vet deel", JSON.stringify(report));
});

await check("links elsewhere are left alone, including the key in their text", () => {
  const node = text("ABC-1 in GitHub", [link("https://github.com/o/r/pull/1")]);
  const { content, report } = patchPara([node]);
  assert(same(content, [node]) && report.changes.length === 0, JSON.stringify(content));
});

await check("existing cards are left alone, even two identical ones side by side", () => {
  const nodes = [cardOf(`${BROWSE}ABC-1`), cardOf(`${BROWSE}ABC-1`)];
  const { content } = patchPara(nodes);
  assert(same(content, nodes), JSON.stringify(content));
});

// --- pull requests ---------------------------------------------------------------------
await check("#1234 becomes a pull-request link only when a repo is given", () => {
  const without = patchPara([text("#5014/#5015")]);
  assert(same(without.content, [text("#5014/#5015")]), JSON.stringify(without.content));

  const { content } = patchPara([text("#5014/#5015 en &#1234; en v#123")], { ...OPTIONS, prRepo: "o/r" });
  assert(
    same(content.slice(0, 3), [
      text("#5014", [link("https://github.com/o/r/pull/5014")]),
      text("/"),
      text("#5015", [link("https://github.com/o/r/pull/5015")]),
    ]),
    JSON.stringify(content)
  );
  assert(content[3].text === " en &#1234; en v#123", JSON.stringify(content));
});

// --- structure -------------------------------------------------------------------------
await check("keys in headings, lists and table cells become cards; the document stays valid", () => {
  const d = doc(
    { type: "heading", attrs: { level: 2 }, content: [text("Over ABC-1")] },
    { type: "bulletList", content: [{ type: "listItem", content: [para(text("item XYZ-2"))] }] },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [{ type: "tableHeader", attrs: {}, content: [para(text("ABC-3"))] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: {}, content: [para(text("ABC-4"))] }] },
      ],
    }
  );
  const report = addSmartLinks(d, OPTIONS);
  valid(d);
  assert(report.changes.length === 4, JSON.stringify(report));
});

await check("nodes other than text round-trip untouched", () => {
  const mention = { type: "mention", attrs: { id: "1", text: "@Someone" } };
  const panel = { type: "panel", attrs: { panelType: "info" }, content: [para(mention, text(" over ABC-1"))] };
  const d = doc(panel);
  addSmartLinks(d, OPTIONS);
  valid(d);
  assert(same(d.content[0].content[0].content[0], mention), JSON.stringify(d));
  assert(d.content[0].attrs.panelType === "info", JSON.stringify(d));
});

// --- options from the environment ------------------------------------------------------
await check("site and projects come from JIRA_HOST and JIRA_SMARTLINK_PROJECTS", () => {
  const opts = smartLinkOptionsFromEnv({ JIRA_HOST: "https://example.atlassian.net/", JIRA_SMARTLINK_PROJECTS: "abc, XYZ" });
  assert(opts.site === SITE && same(opts.projects, ["ABC", "XYZ"]), JSON.stringify(opts));
  assert(same(smartLinkOptionsFromEnv({ JIRA_HOST: SITE }).projects, []), "projects should default to none");
  assert(smartLinkOptionsFromEnv({}) === null, "no host should mean no options");
});

// --- markdown → ADF --------------------------------------------------------------------
process.env.JIRA_HOST = `https://${SITE}`;
delete process.env.JIRA_SMARTLINK_PROJECTS;

await check("markdown links to issues and pages on this site are written as cards", () => {
  const md =
    `Zie [ABC-1: Export mist rijen](${BROWSE}ABC-1), de [handleiding](https://${SITE}/wiki/spaces/X/pages/1/Y) ` +
    `en [de PR](https://github.com/o/r/pull/1).\n\n| Ticket |\n|---|\n| [ABC-2](${BROWSE}ABC-2) |\n`;
  const { adf, smartLinks } = buildADFWithReport(md, "markdown");
  valid(adf);
  const p = adf.content[0].content;
  assert(same(p[1], cardOf(`${BROWSE}ABC-1`)), JSON.stringify(p));
  assert(same(p[3], cardOf(`https://${SITE}/wiki/spaces/X/pages/1/Y`)), JSON.stringify(p));
  assert(p.some((n) => n.text === "de PR" && n.marks?.[0]?.attrs?.href === "https://github.com/o/r/pull/1"), JSON.stringify(p));
  assert(smartLinks.changes.filter((c) => c.kind === "link-to-card").length === 3, JSON.stringify(smartLinks));
});

await check("markdown bare keys stay text unless JIRA_SMARTLINK_PROJECTS names the project", () => {
  const plain = buildADF("zie ABC-1", "markdown");
  assert(same(plain.content[0].content, [text("zie ABC-1")]), JSON.stringify(plain));

  process.env.JIRA_SMARTLINK_PROJECTS = "ABC";
  try {
    const { adf, smartLinks } = buildADFWithReport("zie ABC-1 en `ABC-2` en ABC-3-klasse\n\n```\nABC-4\n```\n", "markdown");
    valid(adf);
    assert(same(adf.content[0].content.slice(0, 2), [text("zie "), cardOf(`${BROWSE}ABC-1`)]), JSON.stringify(adf));
    assert(same(smartLinks.skipped.map((s) => s.key), ["ABC-3"]), JSON.stringify(smartLinks));
    assert(adf.content[1].content[0].text === "ABC-4", "key in a code block was touched");
  } finally {
    delete process.env.JIRA_SMARTLINK_PROJECTS;
  }
});

await check("raw ADF and wiki input are uploaded exactly as given", () => {
  const raw = doc(para(text("ABC-1", [link(`${BROWSE}ABC-1`)])));
  const { adf, smartLinks } = buildADFWithReport(JSON.stringify(raw), "adf");
  assert(same(adf, raw) && smartLinks === null, JSON.stringify(adf));
});

console.log(failures === 0 ? "\nsmartLinks: all checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
