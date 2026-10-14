import type { McpResponse } from "../utils.js";
import { respond, fail, formatJiraError } from "../utils.js";
import { convertADFToMarkdown } from "../shared/helpers.js";
import {
  atlassianGraphql,
  jiraSiteAri,
  type GraphqlClient,
} from "../shared/atlassianGraphql.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGE_SIZE = 50;
/** How far back an ID lookup scans when the ID carries no usable timestamp. */
const SCAN_LIMIT = 500;

export const notificationsDefinition = {
  name: "notifications",
  description:
    "Read your notifications from the Jira site's bell icon (comments, mentions, assignments and other " +
    "activity on items you report, are assigned to or watch), newest first. " +
    "Pass ids to fetch specific notifications (the ID line of each result) instead of the feed. " +
    "With markAsRead, the returned unread notifications are marked as read afterwards, so ids + markAsRead " +
    "marks exactly those; notifications cannot be deleted or dismissed through the API.",
  inputSchema: {
    type: "object",
    properties: {
      ids: {
        type: "array",
        items: { type: "string" },
        description:
          "Notification IDs (from the ID line of earlier results). Returns only these notifications; " +
          "the other filters and limit are ignored.",
      },
      since: {
        type: "string",
        description:
          "Only notifications at or after this time: an ISO date/time (2026-10-01, 2026-10-01T09:00:00Z) " +
          "or a duration back from now (30m, 24h, 7d, 2w).",
      },
      until: {
        type: "string",
        description:
          "Only notifications before this time. Same formats as since.",
      },
      limit: {
        type: "number",
        description: `Maximum number of notifications to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`,
      },
      unreadOnly: {
        type: "boolean",
        description: "Only return unread notifications (default false).",
      },
      category: {
        type: "string",
        enum: ["direct", "watching"],
        description:
          "direct = addressed to you (mentions, assignments, replies); watching = activity on things you watch. " +
          "Default: both.",
      },
      product: {
        type: "string",
        description:
          "Only notifications from this product, e.g. jira or confluence. Default: all products.",
      },
      markAsRead: {
        type: "boolean",
        description:
          "Mark the returned unread notifications as read after fetching them (default false). " +
          "Only the notifications in this result are affected.",
      },
    },
  },
};

export type NotificationsArgs = {
  ids?: string[];
  since?: string;
  until?: string;
  limit?: number;
  unreadOnly?: boolean;
  category?: "direct" | "watching";
  product?: string;
  markAsRead?: boolean;
};

const FEED_QUERY = `query ListNotifications($first: Int, $after: String, $filter: InfluentsNotificationFilter, $routing: String) {
  notifications {
    notificationFeed(first: $first, after: $after, filter: $filter, collabContextRoutingAri: $routing) {
      pageInfo { hasNextPage endCursor }
      nodes {
        groupId
        groupSize
        readStates
        additionalActors { displayName }
        headNotification {
          notificationId
          timestamp
          readState
          category
          content {
            type
            message
            url
            actor { displayName }
            entity { title url }
            path { title }
            bodyItems { type document { format data } }
          }
        }
      }
    }
  }
}`;

const MARK_IDS_READ = `mutation MarkNotificationsRead($ids: [String!]!, $routing: String) {
  notifications { markNotificationsByIdsAsRead(ids: $ids, collabContextRoutingAri: $routing) }
}`;

const MARK_GROUP_READ = `mutation MarkNotificationGroupRead($groupId: String!, $routing: String) {
  notifications {
    markNotificationsByGroupIdAsRead(groupId: $groupId, collabContextRoutingAri: $routing)
  }
}`;

/**
 * Parse an absolute ISO date/time or a relative duration ("24h", "7d") into an ISO timestamp.
 * Returns null when the value is neither.
 */
export function parseTimeFilter(
  value: string,
  now: Date = new Date(),
): string | null {
  const relative = /^\s*(\d+)\s*(m|h|d|w)\s*$/i.exec(value);
  if (relative) {
    const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[
      relative[2].toLowerCase() as "m"
    ];
    return new Date(now.getTime() - Number(relative[1]) * unitMs).toISOString();
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function notificationsHandler(
  args: NotificationsArgs,
  client: GraphqlClient = atlassianGraphql(),
  now: Date = new Date(),
  routingAri: () => Promise<string> = jiraSiteAri,
): Promise<McpResponse> {
  const {
    ids,
    since,
    until,
    unreadOnly = false,
    category,
    product,
    markAsRead = false,
  } = args ?? {};

  // Without a routing ARI the gateway serves only platform-wide notices (admin announcements);
  // the site's Jira notifications live behind the site's ARI. Resolved on first use, so
  // argument errors never cost a request.
  let routing: Promise<string> | undefined;
  const graphql: GraphqlClient = async (query, variables) =>
    client(query, { ...variables, routing: await (routing ??= routingAri()) });

  if (ids !== undefined) {
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.some((id) => typeof id !== "string" || id.trim() === "")
    ) {
      return fail("Error: ids must be a non-empty array of notification IDs");
    }
    return await byIds(graphql, ids, markAsRead);
  }

  const limit = args?.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return fail(
      `Error: limit must be a whole number between 1 and ${MAX_LIMIT}`,
    );
  }
  if (
    category !== undefined &&
    category !== "direct" &&
    category !== "watching"
  ) {
    return fail(`Error: category must be "direct" or "watching"`);
  }

  const filter: Record<string, unknown> = {};
  for (const [name, value, key] of [
    ["since", since, "afterTimestamp"],
    ["until", until, "beforeTimestamp"],
  ] as const) {
    if (value === undefined) continue;
    const parsed = parseTimeFilter(value, now);
    if (!parsed) {
      return fail(
        `Error: ${name} must be an ISO date/time or a duration such as 30m, 24h, 7d or 2w; got "${value}"`,
      );
    }
    filter[key] = parsed;
  }
  if (unreadOnly) filter.readStateFilter = "unread";
  if (category) filter.categoryFilter = category;
  if (product) filter.productFilter = product;

  let items: any[];
  try {
    items = await fetchFeed(graphql, filter, limit);
  } catch (e: any) {
    return fail(formatJiraError("Error fetching notifications", e));
  }

  const timeRange = describeRange(filter);
  if (items.length === 0) {
    return respond(
      `No ${unreadOnly ? "unread " : ""}notifications${timeRange}.`,
    );
  }

  // Marked first, so each notification is listed in the state it is left in.
  const marked = markAsRead ? await markRead(graphql, items) : null;
  const lines = [
    `${items.length} notification(s)${timeRange}, newest first:`,
    "",
    items.map(formatItem).join("\n\n"),
  ];
  if (marked) lines.push("", marked);

  return respond(lines.join("\n"));
}

async function byIds(
  graphql: GraphqlClient,
  ids: string[],
  markAsRead: boolean,
): Promise<McpResponse> {
  const found = new Map<string, any>();
  try {
    for (const id of ids) {
      const item = await findById(graphql, id);
      if (item) found.set(id, item);
    }
  } catch (e: any) {
    return fail(formatJiraError("Error fetching notifications", e));
  }

  const missing = ids.filter((id) => !found.has(id));
  const items = [...found.values()];
  const marked =
    markAsRead && items.length > 0 ? await markRead(graphql, items) : null;
  const lines: string[] = [];
  if (items.length > 0) {
    lines.push(
      `${items.length} notification(s):`,
      "",
      items.map(formatItem).join("\n\n"),
    );
  }
  if (missing.length > 0) {
    if (lines.length) lines.push("");
    lines.push(
      `Not found (${missing.length}): ${missing.join(", ")}`,
      `Searched the ${SCAN_LIMIT} most recent notifications for IDs without an embedded timestamp.`,
    );
  }
  if (marked) lines.push("", marked);

  const response = respond(lines.join("\n"));
  return items.length === 0 ? { ...response, isError: true } : response;
}

/**
 * The feed cannot be filtered by ID. A notification ID is base64 of `<trigger>|<recipient>|<timestamp>`,
 * and the feed's timestamp bounds are exclusive, so a ±1 ms window around that timestamp fetches the
 * notification directly. IDs that do not decode that way fall back to scanning the recent feed.
 */
async function findById(graphql: GraphqlClient, id: string): Promise<any> {
  const matches = (item: any) => item.headNotification?.notificationId === id;
  const timestamp = timestampFromId(id);
  if (timestamp !== null) {
    const window = await fetchFeed(
      graphql,
      {
        afterTimestamp: new Date(timestamp - 1).toISOString(),
        beforeTimestamp: new Date(timestamp + 1).toISOString(),
      },
      PAGE_SIZE,
    );
    const item = window.find(matches);
    if (item) return item;
  }
  return (await fetchFeed(graphql, {}, SCAN_LIMIT)).find(matches);
}

export function timestampFromId(id: string): number | null {
  const decoded = Buffer.from(id, "base64").toString("utf8");
  const last = decoded.split("|").pop() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}T/.test(last)) return null;
  const ms = Date.parse(last);
  return Number.isNaN(ms) ? null : ms;
}

async function fetchFeed(
  graphql: GraphqlClient,
  filter: Record<string, unknown>,
  limit: number,
): Promise<any[]> {
  const items: any[] = [];
  let after: string | undefined;

  while (items.length < limit) {
    const data = await graphql(FEED_QUERY, {
      first: Math.min(PAGE_SIZE, limit - items.length),
      after,
      filter,
    });
    const feed = data?.notifications?.notificationFeed;
    const nodes: any[] = feed?.nodes ?? [];
    items.push(...nodes);

    // The feed can report another page and then return an empty one, so an empty page ends it too.
    if (
      !feed?.pageInfo?.hasNextPage ||
      !feed.pageInfo.endCursor ||
      nodes.length === 0
    )
      break;
    after = feed.pageInfo.endCursor;
  }

  return items.slice(0, limit);
}

function isUnread(item: any): boolean {
  return (
    item.headNotification?.readState === "unread" ||
    (item.readStates ?? []).includes("unread")
  );
}

/**
 * Mark the unread items as read and, once the gateway accepts it, update their read state in
 * place so the response shows them as they now are. The feed itself is eventually consistent,
 * so fetching them again immediately could still report them unread.
 */
async function markRead(graphql: GraphqlClient, items: any[]): Promise<string> {
  const unread = items.filter(isUnread);
  if (unread.length === 0)
    return "Nothing to mark as read: all returned notifications were already read.";

  // A group head stands in for older notifications on the same entity; marking only the head
  // would leave the rest of the group unread, so groups are marked as a whole.
  const singles = unread
    .filter((i) => (i.groupSize ?? 1) <= 1)
    .map((i) => i.headNotification.notificationId);
  const groups = unread
    .filter((i) => (i.groupSize ?? 1) > 1)
    .map((i) => i.groupId);

  try {
    if (singles.length > 0) await graphql(MARK_IDS_READ, { ids: singles });
    for (const groupId of groups) await graphql(MARK_GROUP_READ, { groupId });
  } catch (e: any) {
    return formatJiraError(
      "Fetched the notifications, but marking them as read failed",
      e,
    );
  }
  for (const item of unread) {
    item.headNotification.readState = "read";
    item.readStates = (item.readStates ?? []).map(() => "read");
  }
  return `Marked ${unread.length} notification(s) as read (the feed can take a few seconds to reflect this).`;
}

function describeRange(filter: Record<string, unknown>): string {
  const parts: string[] = [];
  if (filter.afterTimestamp) parts.push(`since ${filter.afterTimestamp}`);
  if (filter.beforeTimestamp) parts.push(`before ${filter.beforeTimestamp}`);
  return parts.length ? ` ${parts.join(" and ")}` : "";
}

function formatItem(item: any): string {
  const head = item.headNotification ?? {};
  const content = head.content ?? {};
  const state = isUnread(item) ? "UNREAD" : "read";
  const actor = content.actor?.displayName ?? "Someone";

  const lines = [
    `[${state}] ${head.timestamp} · ${head.category ?? "unknown"} · ${actor}: ${content.message ?? content.type ?? ""}`,
  ];

  const where = [
    ...(content.path ?? []).map((p: any) => p.title),
    content.entity?.title,
  ].filter(Boolean);
  if (where.length) lines.push(`  On: ${where.join(" › ")}`);

  const url = content.url ?? content.entity?.url;
  if (url) lines.push(`  URL: ${url}`);

  for (const body of content.bodyItems ?? []) {
    const text = renderDocument(body.document);
    if (text) lines.push(indent(text));
  }

  if ((item.groupSize ?? 1) > 1) {
    const others = (item.additionalActors ?? [])
      .map((a: any) => a.displayName)
      .filter(Boolean);
    lines.push(
      `  +${item.groupSize - 1} more in this group${others.length ? ` (also: ${others.join(", ")})` : ""}`,
    );
  }

  lines.push(`  ID: ${head.notificationId}`);
  return lines.join("\n");
}

function renderDocument(document: any): string {
  const data = document?.data;
  if (typeof data !== "string" || data.trim() === "") return "";
  // Rich bodies (comment excerpts) arrive as serialized ADF; plain notices as TEXT.
  if (/adf/i.test(document.format ?? "") || data.trimStart().startsWith("{")) {
    try {
      const doc = JSON.parse(data);
      if (doc?.type === "doc") return convertADFToMarkdown(doc);
    } catch {
      // Not JSON after all: show it as text.
    }
  }
  return data.trim();
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => (line ? `  > ${line}` : "  >"))
    .join("\n");
}
