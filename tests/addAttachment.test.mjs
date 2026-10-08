// Unit test: runs against a fake Jira client. No network access, nothing is written to Jira.
import { addAttachmentHandler } from "../dist/tools/addAttachment.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

function fakeJira() {
  const uploads = [];
  return {
    uploads,
    issueAttachments: {
      addAttachment: async ({ issueIdOrKey, attachment }) => {
        uploads.push({ issueIdOrKey, attachment });
        return attachment.map((a, i) => ({
          id: String(1000 + i),
          filename: a.filename,
          mimeType: "text/plain",
          size: a.file.length,
        }));
      },
    },
  };
}

let failures = 0;
function expect(name, ok, detail) {
  if (ok) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n${detail}\n`);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "add-attachment-"));
const a = path.join(dir, "notes.txt");
const b = path.join(dir, "log.txt");
fs.writeFileSync(a, "hello");
fs.writeFileSync(b, "world!");

// 1. uploads every file in one request, named after the file
{
  const jira = fakeJira();
  const res = await addAttachmentHandler(jira, {
    issueKey: "A-1",
    filePaths: [a, b],
  });
  const text = res.content[0].text;
  const sent = jira.uploads[0]?.attachment ?? [];
  expect(
    "uploads all files in one request",
    !res.isError &&
      jira.uploads.length === 1 &&
      jira.uploads[0].issueIdOrKey === "A-1" &&
      sent.map((s) => s.filename).join(",") === "notes.txt,log.txt" &&
      sent[0].file.toString() === "hello",
    JSON.stringify(jira.uploads),
  );
  expect(
    "reports created attachment IDs",
    text.includes("Uploaded 2 attachment(s) to A-1") &&
      text.includes("ID: 1000 | notes.txt") &&
      text.includes("ID: 1001 | log.txt"),
    text,
  );
}

// 2. a missing file aborts before anything is uploaded
{
  const jira = fakeJira();
  const missing = path.join(dir, "nope.txt");
  const res = await addAttachmentHandler(jira, {
    issueKey: "A-1",
    filePaths: [a, missing],
  });
  expect(
    "missing file uploads nothing",
    res.isError &&
      jira.uploads.length === 0 &&
      res.content[0].text.includes(missing),
    res.content[0].text,
  );
}

// 3. a directory is rejected
{
  const jira = fakeJira();
  const res = await addAttachmentHandler(jira, {
    issueKey: "A-1",
    filePaths: [dir],
  });
  expect(
    "directory is rejected",
    res.isError && jira.uploads.length === 0,
    res.content[0].text,
  );
}

// 4. empty filePaths is rejected
{
  const jira = fakeJira();
  const res = await addAttachmentHandler(jira, {
    issueKey: "A-1",
    filePaths: [],
  });
  expect(
    "empty filePaths is rejected",
    res.isError && res.content[0].text.includes("filePaths"),
    res.content[0].text,
  );
}

fs.rmSync(dir, { recursive: true, force: true });

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
