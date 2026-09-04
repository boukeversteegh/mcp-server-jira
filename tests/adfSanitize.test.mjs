/**
 * Regression tests for ADF nodes that must not have an empty `content` array.
 *
 * A markdown table with an empty header cell (`| | Count | Tenants |`) used to be
 * converted into `{ type: "tableHeader", content: [] }`, which Jira refuses with a
 * generic `400 INVALID_INPUT` naming the field (`errors.comment`) instead of the table.
 *
 * Every case is checked twice: on the shape of the produced ADF, and against the real
 * Atlassian ADF schema (`@atlaskit/adf-schema`), which is the same validator the Jira
 * API applies server-side.
 */
import { createRequire } from "node:module";
import { buildADF } from "../dist/utils.js";

// adf-schema and prosemirror-model must come from the SAME (CJS) module instance,
// otherwise prosemirror complains about "multiple versions loaded".
const require = createRequire(import.meta.url);
const { defaultSchema } = require("@atlaskit/adf-schema/dist/cjs/schema/default-schema.js");
const { Node } = require("prosemirror-model");

let failures = 0;
const ok = (name) => console.log(`PASS  ${name}`);
const bad = (name, detail) => {
  failures++;
  console.log(`FAIL  ${name}\n  ${detail}`);
};

/** Assert the document is accepted by the Atlassian ADF schema. */
function checkValid(name, markdown) {
  const doc = buildADF(markdown, "markdown");
  try {
    Node.fromJSON(defaultSchema, doc).check();
    ok(name);
  } catch (e) {
    bad(name, `schema rejected: ${e.message}\n  ${JSON.stringify(doc)}`);
  }
  return doc;
}

function checkShape(name, condition, doc) {
  if (condition) ok(name);
  else bad(name, `unexpected ADF: ${JSON.stringify(doc)}`);
}

// --- the reported bug: leading empty header cell -----------------------------------
const emptyHeader = checkValid(
  "empty table header cell is valid ADF",
  "| | Count | Tenants |\n|---|---|---|\n| a | 1 | x |\n"
);
const firstHeader = emptyHeader.content[0].content[0].content[0];
checkShape(
  "empty table header cell gets a paragraph",
  firstHeader.type === "tableHeader" && firstHeader.content?.length === 1 &&
    firstHeader.content[0].type === "paragraph",
  firstHeader
);

// --- the same trap elsewhere --------------------------------------------------------
checkValid("empty body cell is valid ADF", "| A | B |\n|---|---|\n| | 1 |\n");
checkValid("header-only table with empty cells is valid ADF", "| | |\n|---|---|\n");

const list = checkValid("empty list item is valid ADF", "- a\n-\n- c\n");
checkShape(
  "empty list item gets a paragraph",
  list.content[0].content[1].content?.length === 1,
  list.content[0].content[1]
);

checkValid("empty blockquote is valid ADF", ">\n");
const code = checkValid("empty code block is valid ADF", "```\n```\n");
checkShape(
  "empty code block has no empty text node",
  !(code.content[0].content ?? []).some((n) => n.type === "text" && n.text === ""),
  code.content[0]
);

// --- non-empty content must be untouched --------------------------------------------
const filled = checkValid(
  "filled table is unchanged and valid",
  "| Mailings | Count |\n|---|---|\n| a | 1 |\n"
);
checkShape(
  "filled header cell keeps its text",
  filled.content[0].content[0].content[0].content[0].content[0].text === "Mailings",
  filled
);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nadfSanitize: all checks passed");
