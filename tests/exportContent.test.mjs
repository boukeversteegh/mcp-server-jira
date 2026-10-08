import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportContentHandler } from "../dist/tools/exportContent.js";

const dir = mkdtempSync(join(tmpdir(), "jira-export-"));

const plainDoc = {
  type: "doc",
  version: 1,
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Timeline" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "bold", marks: [{ type: "strong" }] },
        { type: "text", text: " and a " },
        { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
      ],
    },
  ],
};

// A panel with a mention — neither survives a markdown round-trip.
const richDoc = {
  type: "doc",
  version: 1,
  content: [
    {
      type: "panel",
      attrs: { panelType: "warning" },
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "escalated to " },
            { type: "mention", attrs: { id: "123", text: "@Alex" } },
          ],
        },
      ],
    },
  ],
};

function fakeJira({ description, comment }) {
  return {
    issues: {
      getIssue: async () => ({ key: "X-1", fields: { description, updated: "2026-08-24T10:00:00.000+0200" } }),
    },
    issueComments: {
      getComment: async () => ({ id: "999", body: comment, updated: "2026-08-24T11:00:00.000+0200" }),
    },
  };
}

let failures = 0;
async function check(name, run) {
  try {
    await run();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL  ${name}\n  ${e.message}`);
  }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const textOf = (res) => res.content[0].text;

await check("markdown export of simple content reports it is safe", async () => {
  const res = await exportContentHandler(fakeJira({ description: plainDoc }), { issueKey: "X-1" });
  const text = textOf(res);
  assert(text.includes("can be patched and re-uploaded as markdown safely"), `no safe verdict:\n${text}`);
  assert(text.includes("## Timeline"), "markdown body missing");
  assert(text.includes("Last updated in Jira: 2026-08-24T10:00"), "updated timestamp missing");
});

await check("markdown export of rich content warns about lossy nodes", async () => {
  const res = await exportContentHandler(fakeJira({ description: richDoc }), { issueKey: "X-1" });
  const text = textOf(res);
  assert(text.includes("WARNING"), "no warning");
  assert(text.includes("panel") && text.includes("mention"), `lossy types not listed:\n${text}`);
  assert(text.includes('format: "adf"'), "no adf suggestion");
});

await check("adf export never warns and is valid JSON", async () => {
  const file = join(dir, "desc.json");
  const res = await exportContentHandler(fakeJira({ description: richDoc }), { issueKey: "X-1", filePath: file, format: "adf" });
  const text = textOf(res);
  assert(!text.includes("WARNING"), "adf export should not warn");
  assert(text.includes("restores it exactly"), "no exactness note");
  const written = JSON.parse(readFileSync(file, "utf8"));
  assert(written.content[0].type === "panel", "adf not written verbatim");
});

await check("writing to a file reports the re-upload call", async () => {
  const file = join(dir, "desc.md");
  const res = await exportContentHandler(fakeJira({ description: plainDoc }), { issueKey: "X-1", filePath: file });
  const text = textOf(res);
  assert(text.includes("update-description"), "no re-upload hint");
  assert(readFileSync(file, "utf8").includes("## Timeline"), "file content wrong");
});

await check("comment export targets the comment and hints update-comment", async () => {
  const file = join(dir, "comment.md");
  const res = await exportContentHandler(fakeJira({ comment: plainDoc }), { issueKey: "X-1", commentId: "999", filePath: file });
  const text = textOf(res);
  assert(text.includes("comment 999 on X-1"), `wrong label:\n${text}`);
  assert(text.includes("update-comment") && text.includes('commentId "999"'), "no comment re-upload hint");
});

await check("empty content is reported, not written", async () => {
  const res = await exportContentHandler(fakeJira({ description: null }), { issueKey: "X-1" });
  assert(textOf(res).includes("is empty"), "no empty notice");
});

await check("inline export returns the content when no filePath is given", async () => {
  const res = await exportContentHandler(fakeJira({ description: plainDoc }), { issueKey: "X-1" });
  assert(textOf(res).includes("\n---\n"), "no inline body separator");
});

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
