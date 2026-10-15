// Unit test: runs against a fake Jira client. No network access, nothing is written to Jira.
import { linkIssuesHandler } from "../dist/tools/linkTickets.js";
import { unlinkIssuesHandler } from "../dist/tools/unlinkIssues.js";
import { getTicketDetailsHandler } from "../dist/tools/getTicketDetails.js";

// get-ticket-details looks up deployments on JIRA_HOST; without a host it skips that request.
process.env.JIRA_HOST = "";

// Some sites number their link types; "Blocks" must still resolve to "3. Blocks".
const TYPES = [
  { id: "10000", name: "3. Blocks", inward: "is blocked by", outward: "blocks" },
  { id: "10003", name: "1. Relates", inward: "relates to", outward: "relates to" },
];

/**
 * Fake Jira that stores links the way Jira does, as checked against the Jira UI:
 *  - a create request { inwardIssue: A, outwardIssue: B } on "Blocks" means "A blocks B";
 *  - on issue A that link is listed as { outwardIssue: B } ("A blocks B"), and on issue B
 *    as { inwardIssue: A } ("B is blocked by A").
 *
 * `links` holds the existing links as { type, from, to }, read as "from <outward> to",
 * e.g. { type: "10000", from: "A-1", to: "A-2" } is "A-1 blocks A-2".
 */
function fakeJira(links = []) {
  const store = links.map((l, i) => ({ id: String(100 + i), ...l }));
  const created = [];
  const deleted = [];
  const typeById = (id) => TYPES.find((t) => t.id === id);
  const typeByName = (name) => TYPES.find((t) => t.name === name);
  const ref = (key) => ({
    key,
    fields: { summary: `Summary of ${key}`, issuetype: { name: "Task" }, status: { name: "To Do" } },
  });

  return {
    created,
    deleted,
    issueLinkTypes: { getIssueLinkTypes: async () => ({ issueLinkTypes: TYPES }) },
    issues: {
      getIssue: async ({ issueIdOrKey }) => ({
        id: "1",
        key: issueIdOrKey,
        fields: {
          summary: `Summary of ${issueIdOrKey}`,
          issuelinks: store
            .filter((l) => l.from === issueIdOrKey || l.to === issueIdOrKey)
            .map((l) => ({
              id: l.id,
              type: typeById(l.type),
              ...(l.from === issueIdOrKey ? { outwardIssue: ref(l.to) } : { inwardIssue: ref(l.from) }),
            })),
        },
      }),
    },
    issueLinks: {
      linkIssues: async (body) => {
        const type = typeByName(body.type.name);
        const link = { id: String(100 + store.length), type: type.id, from: body.inwardIssue.key, to: body.outwardIssue.key };
        store.push(link);
        created.push(`${link.from} ${type.outward} ${link.to}`);
      },
      deleteIssueLink: async ({ linkId }) => {
        const i = store.findIndex((l) => l.id === linkId);
        if (i >= 0) store.splice(i, 1);
        deleted.push(linkId);
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

async function check(name, { links, args, expectCreated, expectText }) {
  const jira = fakeJira(links);
  const res = await linkIssuesHandler(jira, args);
  const text = res.content[0].text;
  const got = jira.created.join(",");
  expect(
    name,
    got === expectCreated.join(",") && expectText.every((t) => text.includes(t)),
    `  created: ${got} (expected ${expectCreated.join(",")})\n  text:\n${text}`,
  );
}

const BLOCKS = "10000";
const RELATES = "10003";

// 1. outward keys block inward keys, and the output says so in words
await check("creates outward-blocks-inward", {
  links: [],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCreated: ["A-1 blocks A-2"],
  expectText: ['Link type: "3. Blocks"', "Created 1 links", "A-1 blocks A-2", "asymmetric"],
});

// 2. exact duplicate is skipped (idempotent)
await check("skips exact duplicate", {
  links: [{ type: BLOCKS, from: "A-1", to: "A-2" }],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCreated: [],
  expectText: ["Already existed", "A-1 blocks A-2 (already linked)"],
});

// 3. linkType can be given as the inward description
await check("linkType matches the inward description", {
  links: [{ type: BLOCKS, from: "A-1", to: "A-2" }],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "is blocked by" },
  expectCreated: [],
  expectText: ["already linked"],
});

// 4. symmetric type: reverse-direction link counts as the same link
await check("symmetric reverse is a duplicate", {
  links: [{ type: RELATES, from: "A-2", to: "A-1" }],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Relates" },
  expectCreated: [],
  expectText: ["symmetric", "Already existed"],
});

// 5. asymmetric type: reverse-direction link is a conflict, not created
await check("asymmetric reverse is a conflict", {
  links: [{ type: BLOCKS, from: "A-2", to: "A-1" }],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCreated: [],
  expectText: ["Conflicting 1 links", "opposite link already exists (A-2 blocks A-1)", "allowReciprocal"],
});

// 6. allowReciprocal overrides the conflict
await check("allowReciprocal creates the opposite link", {
  links: [{ type: BLOCKS, from: "A-2", to: "A-1" }],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks", allowReciprocal: true },
  expectCreated: ["A-1 blocks A-2"],
  expectText: ["Created 1 links"],
});

// 7. duplicates within one request collapse
await check("collapses duplicates within one request", {
  links: [],
  args: { outwardIssueKeys: ["A-1", "a-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCreated: ["A-1 blocks A-2"],
  expectText: ["Created 1 links", "Already existed"],
});

// 8. self link rejected
await check("rejects self link", {
  links: [],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-1"], linkType: "Blocks" },
  expectCreated: [],
  expectText: ["cannot link an issue to itself"],
});

// 9. links of a different type do not suppress this one
await check("other link type does not block creation", {
  links: [{ type: RELATES, from: "A-1", to: "A-2" }],
  args: { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" },
  expectCreated: ["A-1 blocks A-2"],
  expectText: ["Created 1 links"],
});

// 10. round trip: a link created by link-issues reads back correctly on both issues
{
  const jira = fakeJira();
  await linkIssuesHandler(jira, { outwardIssueKeys: ["A-1"], inwardIssueKeys: ["A-2"], linkType: "Blocks" });
  const blocker = (await getTicketDetailsHandler(jira, new Map(), { issueKey: "A-1" })).content[0].text;
  const blocked = (await getTicketDetailsHandler(jira, new Map(), { issueKey: "A-2" })).content[0].text;
  expect(
    "get-ticket-details shows the link from each issue's side",
    blocker.includes("blocks A-2 Summary of A-2") &&
      !blocker.includes("is blocked by") &&
      blocked.includes("is blocked by A-1 Summary of A-1") &&
      !blocked.includes("blocks A-1"),
    `A-1:\n${blocker}\n\nA-2:\n${blocked}`,
  );
}

// 11. unlink-issues resolves the type name like link-issues and removes either direction
{
  const jira = fakeJira([
    { type: BLOCKS, from: "A-2", to: "A-1" },
    { type: RELATES, from: "A-1", to: "A-2" },
  ]);
  const res = await unlinkIssuesHandler(jira, { issueKeys: ["A-1"], targetKeys: ["A-2"], linkType: "Blocks" });
  const text = res.content[0].text;
  expect(
    "unlink-issues matches 'Blocks' to '3. Blocks' and keeps other types",
    !res.isError &&
      JSON.stringify(jira.deleted) === '["100"]' &&
      text.includes('Link type filter: "3. Blocks"') &&
      text.includes("A-1 is blocked by A-2"),
    `${text}\n${JSON.stringify(jira.deleted)}`,
  );
}

// 12. unlink-issues refuses an unknown type instead of silently removing nothing
{
  const jira = fakeJira([{ type: BLOCKS, from: "A-1", to: "A-2" }]);
  const res = await unlinkIssuesHandler(jira, { issueKeys: ["A-1"], linkType: "Clones" });
  expect(
    "unlink-issues lists available types for an unknown linkType",
    res.isError && res.content[0].text.includes('"3. Blocks"') && jira.deleted.length === 0,
    res.content[0].text,
  );
}

console.log(failures === 0 ? "\nAll checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
