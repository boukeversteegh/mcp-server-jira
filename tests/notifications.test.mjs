// Unit test: runs against a fake GraphQL client. No network access, nothing is written to Jira.
import {
  notificationsHandler,
  parseTimeFilter,
} from "../dist/tools/notifications.js";

const NOW = new Date("2026-10-13T12:00:00.000Z");

function notification(
  id,
  {
    readState = "unread",
    groupSize = 1,
    timestamp = "2026-10-12T08:00:00.000Z",
    body,
  } = {},
) {
  return {
    groupId: `group-${id}`,
    groupSize,
    readStates: [readState],
    additionalActors: groupSize > 1 ? [{ displayName: "Sam Example" }] : [],
    headNotification: {
      notificationId: `n-${id}`,
      timestamp,
      readState,
      category: "direct",
      content: {
        type: "comment",
        message: `Alex Example commented on PROJ-${id}`,
        url: `https://your-domain.atlassian.net/browse/PROJ-${id}`,
        actor: { displayName: "Alex Example" },
        entity: { title: `PROJ-${id}: Example issue`, url: null },
        path: [{ title: "Example project" }],
        bodyItems: body ? [{ type: "PRIMARY", document: body }] : [],
      },
    },
  };
}

/** Fake gateway serving `pages` in order; records every call. */
function fakeGraphql(pages) {
  const calls = [];
  let page = 0;
  const client = async (query, variables) => {
    calls.push({ query, variables });
    if (query.startsWith("mutation")) return { notifications: {} };
    const nodes = pages[page] ?? [];
    page++;
    return {
      notifications: {
        notificationFeed: {
          nodes,
          pageInfo: {
            hasNextPage: page < pages.length,
            endCursor: page < pages.length ? `cursor-${page}` : null,
          },
        },
      },
    };
  };
  client.calls = calls;
  return client;
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

// 1. time filters accept durations and ISO dates
expect(
  "parses a duration",
  parseTimeFilter("24h", NOW) === "2026-10-12T12:00:00.000Z",
  parseTimeFilter("24h", NOW),
);
expect(
  "parses weeks",
  parseTimeFilter("2w", NOW) === "2026-09-29T12:00:00.000Z",
  parseTimeFilter("2w", NOW),
);
expect(
  "parses an ISO date",
  parseTimeFilter("2026-10-01", NOW) === "2026-10-01T00:00:00.000Z",
  parseTimeFilter("2026-10-01", NOW),
);
expect(
  "rejects nonsense",
  parseTimeFilter("soon", NOW) === null,
  parseTimeFilter("soon", NOW),
);

// 2. filters are passed to the feed and results are rendered
{
  const gql = fakeGraphql([
    [
      notification(1, {
        body: {
          format: "ADF",
          data: JSON.stringify({
            type: "doc",
            version: 1,
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "Looks good",
                    marks: [{ type: "strong" }],
                  },
                ],
              },
            ],
          }),
        },
      }),
      notification(2, {
        readState: "read",
        groupSize: 3,
        body: { format: "TEXT", data: "plain body" },
      }),
    ],
  ]);
  const res = await notificationsHandler(
    {
      since: "7d",
      until: "2026-10-13",
      unreadOnly: true,
      category: "direct",
      product: "jira",
    },
    gql,
    NOW,
  );
  const text = res.content[0].text;
  const filter = gql.calls[0].variables.filter;
  expect(
    "builds the feed filter",
    filter.afterTimestamp === "2026-10-06T12:00:00.000Z" &&
      filter.beforeTimestamp === "2026-10-13T00:00:00.000Z" &&
      filter.readStateFilter === "unread" &&
      filter.categoryFilter === "direct" &&
      filter.productFilter === "jira",
    JSON.stringify(filter),
  );
  expect(
    "renders state, message, location and body",
    !res.isError &&
      text.includes("2 notification(s) since 2026-10-06T12:00:00.000Z") &&
      text.includes(
        "[UNREAD] 2026-10-12T08:00:00.000Z · direct · Alex Example: Alex Example commented on PROJ-1",
      ) &&
      text.includes("On: Example project › PROJ-1: Example issue") &&
      text.includes("URL: https://your-domain.atlassian.net/browse/PROJ-1") &&
      text.includes("> **Looks good**") &&
      text.includes("[read]") &&
      text.includes("> plain body") &&
      text.includes("+2 more in this group (also: Sam Example)"),
    text,
  );
  expect(
    "does not mark anything by default",
    gql.calls.every((c) => !c.query.startsWith("mutation")),
    JSON.stringify(gql.calls.map((c) => c.query.slice(0, 30))),
  );
}

// 3. pagination stops at the limit
{
  const gql = fakeGraphql([
    [notification(1), notification(2)],
    [notification(3), notification(4)],
    [notification(5)],
  ]);
  const res = await notificationsHandler({ limit: 3 }, gql, NOW);
  const text = res.content[0].text;
  const feedCalls = gql.calls.filter((c) => c.query.startsWith("query"));
  expect(
    "follows cursors and truncates to limit",
    text.startsWith("3 notification(s)") &&
      text.includes("PROJ-3") &&
      !text.includes("PROJ-4") &&
      feedCalls.length === 2 &&
      feedCalls[0].variables.first === 3 &&
      feedCalls[1].variables.after === "cursor-1" &&
      feedCalls[1].variables.first === 1,
    `${text}\n${JSON.stringify(feedCalls.map((c) => c.variables))}`,
  );
}

// 4. an empty page ends pagination even when the feed claims there is more
{
  const gql = fakeGraphql([[notification(1)], [], [notification(9)]]);
  const res = await notificationsHandler({ limit: 10 }, gql, NOW);
  expect(
    "stops on an empty page",
    res.content[0].text.startsWith("1 notification(s)") &&
      gql.calls.length === 2,
    res.content[0].text,
  );
}

// 5. markAsRead marks only the returned unread notifications, groups as a whole
{
  const gql = fakeGraphql([
    [
      notification(1),
      notification(2, { readState: "read" }),
      notification(3, { groupSize: 4 }),
    ],
  ]);
  const res = await notificationsHandler({ markAsRead: true }, gql, NOW);
  const mutations = gql.calls.filter((c) => c.query.startsWith("mutation"));
  expect(
    "marks unread singles by ID and groups by group ID",
    mutations.length === 2 &&
      mutations[0].query.includes("markNotificationsByIdsAsRead") &&
      JSON.stringify(mutations[0].variables.ids) === '["n-1"]' &&
      mutations[1].query.includes("markNotificationsByGroupIdAsRead") &&
      mutations[1].variables.groupId === "group-3" &&
      res.content[0].text.includes("Marked 2 notification(s) as read"),
    `${res.content[0].text}\n${JSON.stringify(mutations)}`,
  );
}

// 6. invalid arguments are refused before any request
{
  const gql = fakeGraphql([]);
  const badSince = await notificationsHandler({ since: "soon" }, gql, NOW);
  const badLimit = await notificationsHandler({ limit: 500 }, gql, NOW);
  expect(
    "rejects bad since and limit without calling the gateway",
    badSince.isError &&
      badSince.content[0].text.includes('got "soon"') &&
      badLimit.isError &&
      gql.calls.length === 0,
    `${badSince.content[0].text}\n${badLimit.content[0].text}`,
  );
}

// 7. a gateway failure is reported as a tool error
{
  const res = await notificationsHandler(
    {},
    async () => {
      throw new Error("GraphQL error: Unauthorized");
    },
    NOW,
  );
  expect(
    "reports gateway errors",
    res.isError &&
      res.content[0].text.includes(
        "Error fetching notifications: GraphQL error: Unauthorized",
      ),
    res.content[0].text,
  );
}

// ── Lookup by ID ─────────────────────────────────────────────────────────────

/** IDs in the shape the gateway issues: base64 of `<trigger>|<recipient>|<timestamp>`. */
function realisticId(n, timestamp) {
  return Buffer.from(
    `ari:cloud:example::trigger/${n}|ari:cloud:identity::user/abc|${timestamp}`,
  ).toString("base64");
}

function withId(item, id, timestamp) {
  return {
    ...item,
    headNotification: {
      ...item.headNotification,
      notificationId: id,
      timestamp,
    },
  };
}

/** Fake gateway that applies the feed's exclusive timestamp bounds to a fixed list. */
function filteringGraphql(items) {
  const calls = [];
  const client = async (query, variables) => {
    calls.push({ query, variables });
    if (query.startsWith("mutation")) return { notifications: {} };
    const { afterTimestamp, beforeTimestamp } = variables.filter ?? {};
    const nodes = items.filter((i) => {
      const t = Date.parse(i.headNotification.timestamp);
      return (
        (!afterTimestamp || t > Date.parse(afterTimestamp)) &&
        (!beforeTimestamp || t < Date.parse(beforeTimestamp))
      );
    });
    return {
      notifications: {
        notificationFeed: {
          nodes: nodes.slice(0, variables.first),
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    };
  };
  client.calls = calls;
  return client;
}

const T1 = "2026-10-12T08:00:00.000Z";
const T2 = "2026-10-12T08:00:00.001Z";
const ID1 = realisticId(1, T1);
const ID2 = realisticId(2, T2);
const feedItems = [
  withId(notification(1), ID1, T1),
  withId(notification(2), ID2, T2),
  withId(notification(3), "opaque-id", "2026-10-01T00:00:00.000Z"),
];

// 8. an ID is looked up through a ±1 ms window around its embedded timestamp
{
  const gql = filteringGraphql(feedItems);
  const res = await notificationsHandler(
    { ids: [ID1], since: "1h", limit: 1 },
    gql,
    NOW,
  );
  const text = res.content[0].text;
  const filter = gql.calls[0].variables.filter;
  expect(
    "finds a notification by ID, ignoring the other filters",
    !res.isError &&
      text.startsWith("1 notification(s):") &&
      text.includes("PROJ-1") &&
      !text.includes("PROJ-2") &&
      gql.calls.length === 1 &&
      filter.afterTimestamp === "2026-10-12T07:59:59.999Z" &&
      filter.beforeTimestamp === "2026-10-12T08:00:00.001Z",
    `${text}\n${JSON.stringify(gql.calls.map((c) => c.variables))}`,
  );
}

// 9. ids + markAsRead marks exactly those notifications
{
  const gql = filteringGraphql(feedItems);
  const res = await notificationsHandler(
    { ids: [ID2], markAsRead: true },
    gql,
    NOW,
  );
  const mutations = gql.calls.filter((c) => c.query.startsWith("mutation"));
  expect(
    "marks only the requested notification",
    mutations.length === 1 &&
      JSON.stringify(mutations[0].variables.ids) === JSON.stringify([ID2]) &&
      res.content[0].text.includes("Marked 1 notification(s) as read"),
    `${res.content[0].text}\n${JSON.stringify(mutations)}`,
  );
}

// 10. an ID without a timestamp falls back to scanning; unknown IDs are reported
{
  const gql = filteringGraphql(feedItems);
  const res = await notificationsHandler(
    { ids: ["opaque-id", "missing-id"], markAsRead: true },
    gql,
    NOW,
  );
  const text = res.content[0].text;
  const mutations = gql.calls.filter((c) => c.query.startsWith("mutation"));
  expect(
    "scans for opaque IDs and lists the ones not found",
    !res.isError &&
      text.includes("PROJ-3") &&
      text.includes("Not found (1): missing-id") &&
      mutations.length === 1 &&
      JSON.stringify(mutations[0].variables.ids) === '["opaque-id"]',
    `${text}\n${JSON.stringify(mutations)}`,
  );
}

// 11. nothing found is an error and marks nothing
{
  const gql = filteringGraphql(feedItems);
  const res = await notificationsHandler(
    { ids: ["missing-id"], markAsRead: true },
    gql,
    NOW,
  );
  expect(
    "reports an error when no ID is found",
    res.isError &&
      res.content[0].text.includes("Not found (1): missing-id") &&
      gql.calls.every((c) => !c.query.startsWith("mutation")),
    res.content[0].text,
  );
}

// 12. ids must be a non-empty array of strings
{
  const gql = filteringGraphql(feedItems);
  const empty = await notificationsHandler({ ids: [] }, gql, NOW);
  const notArray = await notificationsHandler({ ids: ID1 }, gql, NOW);
  expect(
    "rejects malformed ids",
    empty.isError && notArray.isError && gql.calls.length === 0,
    `${empty.content[0].text}\n${notArray.content[0].text}`,
  );
}

if (failures > 0) {
  console.log(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll notifications tests passed");
