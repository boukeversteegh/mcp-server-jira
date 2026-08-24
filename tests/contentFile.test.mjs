import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveContent, formatFromExtension } from "../dist/utils.js";

const dir = mkdtempSync(join(tmpdir(), "jira-content-"));
const write = (name, body) => {
  const p = join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
};

const md = write("desc.md", "## Heading\n\n**bold**\n");
const wiki = write("desc.wiki", "h2. Heading\n\n*bold*\n");
const jiraExt = write("desc.jira", "h2. Heading\n");
const adf = write("desc.json", JSON.stringify({ type: "doc", content: [] }));
const txt = write("desc.txt", "just text\n");
const odd = write("desc.rst", "some text\n");
const empty = write("empty.md", "   \n");

let failures = 0;
async function check(name, args, expect) {
  const got = await resolveContent({ inlineArgName: "description", ...args });
  const ok = Object.entries(expect).every(([k, v]) =>
    k === "error" ? got.error?.includes(v) : got[k] === v
  );
  if (ok) console.log(`PASS  ${name}`);
  else {
    failures++;
    console.log(`FAIL  ${name}\n  got: ${JSON.stringify(got)}\n  expected: ${JSON.stringify(expect)}`);
  }
}

// extension mapping
const extCases = [
  [".md", "markdown"], [".markdown", "markdown"], [".wiki", "wiki"],
  [".jira", "wiki"], [".json", "adf"], [".adf", "adf"], [".txt", "plain"], [".rst", null],
];
for (const [ext, expected] of extCases) {
  const got = formatFromExtension(`x${ext}`);
  if (got === expected) console.log(`PASS  extension ${ext} -> ${expected}`);
  else { failures++; console.log(`FAIL  extension ${ext}: got ${got}, expected ${expected}`); }
}

await check("markdown file infers markdown", { filePath: md }, { format: "markdown", text: "## Heading\n\n**bold**\n" });
await check("wiki file infers wiki", { filePath: wiki }, { format: "wiki" });
await check(".jira file infers wiki", { filePath: jiraExt }, { format: "wiki" });
await check("json file infers adf", { filePath: adf }, { format: "adf" });
await check("txt file infers plain", { filePath: txt }, { format: "plain" });
await check("explicit format wins over extension", { filePath: txt, format: "markdown" }, { format: "markdown" });
await check("unknown extension without format errors", { filePath: odd }, { error: "cannot infer the format" });
await check("unknown extension with format is accepted", { filePath: odd, format: "markdown" }, { format: "markdown" });
await check("missing file errors", { filePath: join(dir, "nope.md") }, { error: "file not found" });
await check("empty file is refused", { filePath: empty }, { error: "Refusing to replace existing content" });
await check("inline text still works", { inline: "hello" }, { format: "plain", text: "hello", source: "inline text" });
await check("inline text honours explicit format", { inline: "# hi", format: "markdown" }, { format: "markdown" });
await check("both inline and file errors", { inline: "hi", filePath: md }, { error: "not both" });
await check("neither inline nor file errors", {}, { error: "is required" });

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
