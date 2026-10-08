import { addSmartLinksHandler } from "../dist/tools/addSmartLinks.js";
import { contentVersion } from "../dist/shared/contentVersion.js";

process.env.JIRA_HOST = "https://example.atlassian.net";
process.env.JIRA_SMARTLINK_PROJECTS = "ABC";

const BROWSE = "https://example.atlassian.net/browse/";
const doc = (...content) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content }] });
const text = (t) => ({ type: "text", text: t });

/**
 * Jira double. `reads` is the sequence of contents successive reads return (the last one
 * repeats), so a test can let the content change between the patch and the version check.
 */
function fakeJira(reads, { visibility } = {}) {
  const writes = [];
  let i = 0;
  const next = () => structuredClone(reads[Math.min(i++, reads.length - 1)]);
  return {
    writes,
    issues: {
      getIssue: async () => ({ fields: { description: next(), updated: "2026-10-08T10:00:00.000+0200" } }),
      editIssue: async (req) => {
        writes.push(req);
        reads.push(req.fields.description);
        i = reads.length - 1;
      },
    },
    issueComments: {
      getComment: async () => ({ body: next(), updated: "2026-10-08T10:00:00.000+0200", ...(visibility ? { visibility } : {}) }),
      updateComment: async (req) => {
        writes.push(req);
        reads.push(req.body);
        i = reads.length - 1;
      },
    },
  };
}

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
const out = (res) => res.content.map((c) => c.text).join("");

await check("dry run reports the changes and writes nothing", async () => {
  const jira = fakeJira([doc(text("zie ABC-1 en ABC-2-klasse"))]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1", dryRun: true }));
  assert(jira.writes.length === 0, "dry run wrote");
  assert(res.includes("key  -> card   ABC-1"), res);
  assert(res.includes("SKIPPED        ABC-2"), res);
  assert(res.includes("inlineCard 0 -> 1"), res);
  assert(res.includes("Dry run"), res);
});

await check("the description is patched and the new version reported", async () => {
  const original = doc(text("zie ABC-1"));
  const jira = fakeJira([original]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1" }));
  assert(jira.writes.length === 1, `expected one write, got ${jira.writes.length}`);
  const written = jira.writes[0].fields.description;
  assert(written.content[0].content[1].type === "inlineCard", JSON.stringify(written));
  assert(written.content[0].content[1].attrs.url === `${BROWSE}ABC-1`, JSON.stringify(written));
  assert(res.includes(`New version: ${contentVersion(written)}`), res);
});

await check("a comment keeps its visibility restriction", async () => {
  const visibility = { type: "role", value: "Developers" };
  const jira = fakeJira([doc(text("ABC-1"))], { visibility });
  await addSmartLinksHandler(jira, { issueKey: "X-1", commentId: "42" });
  assert(jira.writes.length === 1 && jira.writes[0].id === "42", JSON.stringify(jira.writes));
  assert(JSON.stringify(jira.writes[0].visibility) === JSON.stringify(visibility), JSON.stringify(jira.writes[0]));
});

await check("nothing to change means nothing written", async () => {
  const jira = fakeJira([doc(text("niets te linken"))]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1" }));
  assert(jira.writes.length === 0, "wrote without changes");
  assert(res.includes("Nothing to write"), res);
});

await check("an edit made between reading and writing is not overwritten", async () => {
  const jira = fakeJira([doc(text("ABC-1")), doc(text("someone else's edit ABC-1"))]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1" }));
  assert(jira.writes.length === 0, "overwrote a concurrent edit");
  assert(res.includes("changed in Jira"), res);
});

await check("projects passed to the tool replace JIRA_SMARTLINK_PROJECTS", async () => {
  const jira = fakeJira([doc(text("ABC-1 en XYZ-2"))]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1", projects: ["xyz"], dryRun: true }));
  assert(res.includes("key  -> card   XYZ-2") && !res.includes("ABC-1"), res);

  const none = out(await addSmartLinksHandler(fakeJira([doc(text("ABC-1"))]), { issueKey: "X-1", projects: [] }));
  assert(none.includes("Bare issue keys were not looked for"), none);
});

await check("invalid projects and prRepo are refused", async () => {
  const jira = fakeJira([doc(text("ABC-1"))]);
  const bad = out(await addSmartLinksHandler(jira, { issueKey: "X-1", projects: ["ABC-1"] }));
  assert(bad.startsWith("Error:"), bad);
  const repo = out(await addSmartLinksHandler(jira, { issueKey: "X-1", prRepo: "not a repo" }));
  assert(repo.startsWith("Error:"), repo);
  assert(jira.writes.length === 0, "wrote despite invalid input");
});

await check("prRepo links #1234 to the pull request", async () => {
  const jira = fakeJira([doc(text("zie #5014"))]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1", prRepo: "o/r", dryRun: true }));
  assert(res.includes("#5014 -> https://github.com/o/r/pull/5014"), res);
});

await check("empty content is reported, not written", async () => {
  const jira = fakeJira([null]);
  const res = out(await addSmartLinksHandler(jira, { issueKey: "X-1" }));
  assert(res.includes("is empty") && jira.writes.length === 0, res);
});

console.log(failures === 0 ? "\naddSmartLinks: all checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
