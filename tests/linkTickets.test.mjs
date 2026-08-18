import { linkIssuesHandler } from "../dist/tools/linkTickets.js";

const TYPES = [
  { id: "10000", name: "Blocks", inward: "is blocked by", outward: "blocks" },
  { id: "10003", name: "Relates", inward: "relates to", outward: "relates to" },
];

// existing: map issueKey -> array of {typeId, inward?|outward?}
// Real Jira semantics (verified live): an issue's own link list contains only the OTHER
// end of each link, under the field naming that other issue's role. So on issue X,
// `inward: "Y"` means the link is (outwardIssue: X, inwardIssue: Y) i.e. X -> Y, and
// `outward: "Y"` means (outwardIssue: Y, inwardIssue: X) i.e. Y -> X.
function fakeJira(existing) {
  const calls = [];
  return {
    calls,
    issueLinkTypes: { getIssueLinkTypes: async () => ({ issueLinkTypes: TYPES }) },
    issues: {
      getIssue: async ({ issueIdOrKey }) => ({
        key: issueIdOrKey,
        fields: {
          issuelinks: (existing[issueIdOrKey] ?? []).map((l) => ({
            id: "1",
            type: TYPES.find((t) => t.id === l.typeId),
            ...(l.outward ? { outwardIssue: { key: l.outward } } : {}),
            ...(l.inward ? { inwardIssue: { key: l.inward } } : {}),
          })),
        },
      }),
    },
    issueLinks: {
      linkIssues: async (body) => {
        calls.push(`${body.outwardIssue.key}->${body.inwardIssue.key}`);
      },
    },
  };
}

let failures = 0;
async function check(name, { existing, args, expectCalls, expectText }) {
  const jira = fakeJira(existing);
  const res = await linkIssuesHandler(jira, args);
  const text = res.content[0].text;
  const gotCalls = jira.calls.join(",");
  const okCalls = gotCalls === expectCalls.join(",");
  const okText = expectText.every((t) => text.includes(t));
  if (okCalls && okText) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}\n  calls: ${gotCalls} (expected ${expectCalls.join(",")})\n  text:\n${text}\n`);
  }
}

// 1. fresh link is created
await check("creates a new link", {
  existing: {},
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCalls: ["A-1->A-2"],
  expectText: ["Created 1 links", "A-1 -> A-2", "asymmetric"],
});

// 2. exact duplicate is skipped (idempotent)
await check("skips exact duplicate", {
  existing: { "A-1": [{ typeId: "10000", inward: "A-2" }] },
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCalls: [],
  expectText: ["Already existed", "already linked"],
});

// 3. symmetric type: reverse-direction link counts as the same link
await check("symmetric reverse is a duplicate", {
  existing: { "A-1": [{ typeId: "10003", outward: "A-2" }] },
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Relates" },
  expectCalls: [],
  expectText: ["symmetric", "Already existed"],
});

// 4. asymmetric type: reverse-direction link is a conflict, not created
await check("asymmetric reverse is a conflict", {
  existing: { "A-1": [{ typeId: "10000", outward: "A-2" }] },
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCalls: [],
  expectText: ["Conflicting 1 links", "opposite link already exists", "allowReciprocal"],
});

// 5. allowReciprocal overrides the conflict
await check("allowReciprocal creates the opposite link", {
  existing: { "A-1": [{ typeId: "10000", outward: "A-2" }] },
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks", allowReciprocal: true },
  expectCalls: ["A-1->A-2"],
  expectText: ["Created 1 links"],
});

// 6. duplicates within one request collapse
await check("collapses duplicates within one request", {
  existing: {},
  args: { outwardIssueKeys: ["A-1", "a-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCalls: ["A-1->A-2"],
  expectText: ["Created 1 links", "Already existed"],
});

// 7. self link rejected
await check("rejects self link", {
  existing: {},
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-1"], linkType: "Blocks" },
  expectCalls: [],
  expectText: ["cannot link an issue to itself"],
});

// 8. links of a different type do not suppress this one
await check("other link type does not block creation", {
  existing: { "A-1": [{ typeId: "10003", outward: "A-2" }] },
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCalls: ["A-1->A-2"],
  expectText: ["Created 1 links"],
});

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
