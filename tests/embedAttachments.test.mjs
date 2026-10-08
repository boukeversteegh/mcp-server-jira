// Unit test: runs against a fake Jira client. No network access, nothing is written to Jira.
import { planEmbeds, applyEmbeds } from "../dist/shared/embedAttachments.js";
import { buildADF } from "../dist/utils.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const UUID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function fakeJira(existing = []) {
  const uploads = [];
  let next = 500;
  return {
    uploads,
    issues: {
      getIssue: async () => ({ fields: { attachment: existing } }),
    },
    issueAttachments: {
      addAttachment: async ({ attachment }) => {
        uploads.push(...attachment.map((a) => a.filename));
        return attachment.map((a) => ({
          id: String(next++),
          filename: a.filename,
          size: a.file.length,
          mimeType: a.filename.endsWith(".pdf")
            ? "application/pdf"
            : "image/png",
        }));
      },
    },
  };
}

// Media IDs are derived from the attachment ID so the test can check which one was used.
const mediaIdOf = async (a) => UUID(a.id);

function mediaNodes(adf) {
  const out = [];
  const walk = (n, parent) => {
    if (n?.type === "media") out.push({ attrs: n.attrs, parent: parent?.type });
    (n?.content ?? []).forEach((c) => walk(c, n));
  };
  walk(adf, null);
  return out;
}

let failures = 0;
function expect(name, ok, detail) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(
      `FAIL  ${name}\n${typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)}\n`,
    );
  }
}

async function embed(jira, adf, baseDir) {
  const planned = await planEmbeds(jira, "A-1", adf, baseDir);
  if ("error" in planned) return { error: planned.error };
  return { lines: await applyEmbeds(jira, "A-1", planned.plan, mediaIdOf) };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "embed-"));
fs.mkdirSync(path.join(dir, "img"));
fs.writeFileSync(path.join(dir, "img", "shot.png"), "PNGDATA");
fs.writeFileSync(path.join(dir, "my shot.png"), "PNG2");
fs.writeFileSync(path.join(dir, "report.pdf"), "PDF");

// 1. markdown image with a local path is uploaded and embedded by media ID
{
  const jira = fakeJira();
  const adf = buildADF("Look:\n\n![the bug](./img/shot.png)", "markdown");
  const res = await embed(jira, adf, dir);
  const [m] = mediaNodes(adf);
  expect(
    "local markdown image is uploaded and embedded",
    jira.uploads.join() === "shot.png" &&
      m.attrs.type === "file" &&
      m.attrs.id === UUID(500) &&
      m.attrs.collection === "" &&
      m.attrs.alt === "the bug" &&
      m.attrs.url === undefined &&
      m.parent === "mediaSingle" &&
      res.lines[0].includes("uploaded"),
    { uploads: jira.uploads, m, res },
  );
}

// 2. an identical attachment (same name and size) is reused, not uploaded again
{
  const jira = fakeJira([
    { id: "77", filename: "shot.png", size: 7, mimeType: "image/png" },
  ]);
  const adf = buildADF("![](img/shot.png)", "markdown");
  const res = await embed(jira, adf, dir);
  const [m] = mediaNodes(adf);
  expect(
    "identical existing attachment is reused",
    jira.uploads.length === 0 &&
      m.attrs.id === UUID(77) &&
      m.attrs.alt === "shot.png" &&
      res.lines[0].includes("already attached"),
    { uploads: jira.uploads, m, res },
  );
}

// 3. a same-named attachment with a different size is a new version: upload it
{
  const jira = fakeJira([
    { id: "77", filename: "shot.png", size: 3, mimeType: "image/png" },
  ]);
  const adf = buildADF("![](img/shot.png)", "markdown");
  await embed(jira, adf, dir);
  expect(
    "changed file is uploaded again",
    jira.uploads.join() === "shot.png" &&
      mediaNodes(adf)[0].attrs.id === UUID(500),
    jira.uploads,
  );
}

// 4. attachment:<name> and attachment:<id> point at existing attachments
{
  const jira = fakeJira([
    {
      id: "10",
      filename: "old.png",
      created: "2026-01-01",
      mimeType: "image/png",
    },
    {
      id: "11",
      filename: "old.png",
      created: "2026-02-01",
      mimeType: "image/png",
    },
    { id: "12", filename: "other.png", mimeType: "image/png" },
  ]);
  const adf = buildADF(
    "![](attachment:old.png)\n\n![](attachment:12)",
    "markdown",
  );
  await embed(jira, adf, dir);
  const ids = mediaNodes(adf).map((m) => m.attrs.id);
  expect(
    "attachment: prefix picks newest by name, or by ID",
    jira.uploads.length === 0 && ids.join() === [UUID(11), UUID(12)].join(),
    ids,
  );
}

// 5. wiki !name! with no local file falls back to an attachment of that name; wiki's
//    placeholder dimensions and __external flag are dropped
{
  const jira = fakeJira([
    { id: "31", filename: "diagram.png", mimeType: "image/png" },
  ]);
  const adf = buildADF("!diagram.png!", "wiki");
  await embed(jira, adf, dir);
  const [m] = mediaNodes(adf);
  expect(
    "wiki image resolves to existing attachment",
    m.attrs.id === UUID(31) &&
      m.attrs.width === undefined &&
      m.attrs.height === undefined &&
      m.attrs.__external === undefined,
    m,
  );
}

// 6. a non-image file in a mediaSingle becomes a mediaGroup file card
{
  const jira = fakeJira();
  const adf = buildADF("![](report.pdf)", "markdown");
  await embed(jira, adf, dir);
  const [m] = mediaNodes(adf);
  expect(
    "non-image becomes mediaGroup",
    m.parent === "mediaGroup" && m.attrs.id === UUID(500),
    m,
  );
}

// 7. URL-encoded paths are decoded
{
  const jira = fakeJira();
  const adf = buildADF("![](my%20shot.png)", "markdown");
  const res = await embed(jira, adf, dir);
  expect(
    "URL-encoded path resolves",
    !res.error && jira.uploads.join() === "my shot.png",
    res,
  );
}

// 8. any unresolved reference aborts before anything is uploaded
{
  const jira = fakeJira();
  const adf = buildADF(
    "![](img/shot.png)\n\n![](nope.png)\n\n![](attachment:gone.png)",
    "markdown",
  );
  const res = await embed(jira, adf, dir);
  expect(
    "unresolved reference uploads nothing and names every problem",
    res.error &&
      jira.uploads.length === 0 &&
      res.error.includes("nope.png") &&
      res.error.includes("attachment:gone.png") &&
      !res.error.includes("img/shot.png"),
    res.error ?? res,
  );
}

// 9. web images and already-embedded files are left alone
{
  const jira = fakeJira();
  const adf = buildADF("![](https://example.com/a.png)", "markdown");
  adf.content.push({
    type: "mediaSingle",
    content: [
      { type: "media", attrs: { type: "file", id: UUID(9), collection: "" } },
    ],
  });
  const before = JSON.stringify(adf);
  const res = await embed(jira, adf, dir);
  expect(
    "URLs and media IDs are untouched",
    JSON.stringify(adf) === before &&
      res.lines.length === 0 &&
      jira.uploads.length === 0,
    adf,
  );
}

// 10. the same reference twice is uploaded once
{
  const jira = fakeJira();
  const adf = buildADF(
    "![](img/shot.png)\n\n![again](img/shot.png)",
    "markdown",
  );
  await embed(jira, adf, dir);
  const ids = mediaNodes(adf).map((m) => m.attrs.id);
  expect(
    "repeated reference uploads once",
    jira.uploads.length === 1 && ids[0] === ids[1],
    { uploads: jira.uploads, ids },
  );
}

// 11. a ticket that does not exist yet has no attachments to fall back on
{
  const jira = fakeJira();
  const adf = buildADF("![](attachment:x.png)", "markdown");
  const planned = await planEmbeds(jira, undefined, adf, dir);
  expect(
    "attachment: refused before the ticket exists",
    "error" in planned && planned.error.includes("does not exist yet"),
    planned,
  );
}

fs.rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nembedAttachments: all checks passed");
