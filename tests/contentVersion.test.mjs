import { contentVersion, checkVersion } from "../dist/shared/contentVersion.js";

const doc = (text) => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

function fakeJira(adf, updated = "2026-08-24T10:00:00.000+0200") {
  return {
    issues: { getIssue: async () => ({ fields: { description: adf, updated } }) },
    issueComments: { getComment: async () => ({ body: adf, updated }) },
  };
}

let failures = 0;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
async function check(name, run) {
  try { await run(); console.log(`PASS  ${name}`); }
  catch (e) { failures++; console.log(`FAIL  ${name}\n  ${e.message}`); }
}

await check("version is stable and key-order independent", () => {
  const a = { type: "doc", version: 1, content: [] };
  const b = { content: [], version: 1, type: "doc" };
  assert(contentVersion(a) === contentVersion(b), "key order changed the version");
  assert(contentVersion(a).startsWith("v1-"), "unexpected version format");
});

await check("different content yields a different version", () => {
  assert(contentVersion(doc("a")) !== contentVersion(doc("b")), "collision on different content");
});

await check("empty content still has a version", () => {
  assert(contentVersion(null).startsWith("v1-"), "no version for empty content");
  assert(contentVersion(null) !== contentVersion(doc("a")), "empty matches non-empty");
});

await check("missing expectedVersion is refused", async () => {
  const err = await checkVersion({ jira: fakeJira(doc("a")), issueKey: "X-1" });
  assert(err?.includes("requires expectedVersion"), `expected a refusal, got: ${err}`);
});

await check("missing expectedVersion is allowed with force", async () => {
  const err = await checkVersion({ jira: fakeJira(doc("a")), issueKey: "X-1", force: true });
  assert(err === null, `force should bypass, got: ${err}`);
});

await check("matching version passes", async () => {
  const adf = doc("a");
  const err = await checkVersion({ jira: fakeJira(adf), issueKey: "X-1", expectedVersion: contentVersion(adf) });
  assert(err === null, `expected pass, got: ${err}`);
});

await check("stale version is refused with both versions and the timestamp", async () => {
  const stale = contentVersion(doc("old"));
  const err = await checkVersion({ jira: fakeJira(doc("new")), issueKey: "X-1", expectedVersion: stale });
  assert(err?.includes(stale), "stale version not named");
  assert(err?.includes(contentVersion(doc("new"))), "current version not named");
  assert(err?.includes("last updated 2026-08-24"), "timestamp not shown");
  assert(err?.includes("force: true"), "no override hint");
});

await check("stale version is overridden by force", async () => {
  const err = await checkVersion({
    jira: fakeJira(doc("new")), issueKey: "X-1", expectedVersion: contentVersion(doc("old")), force: true,
  });
  assert(err === null, `force should bypass, got: ${err}`);
});

await check("comment target is named in the refusal", async () => {
  const err = await checkVersion({ jira: fakeJira(doc("a")), issueKey: "X-1", commentId: "42" });
  assert(err?.includes("comment 42 on X-1"), `wrong target label: ${err}`);
});

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
