import type { McpResponse } from "../utils.js";
import { respond, fail, formatJiraError } from "../utils.js";
import { convertADFToMarkdown } from "../shared/helpers.js";
import {
  atlassianGraphql,
  type GraphqlClient,
} from "../shared/atlassianGraphql.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const PAGE_SIZE = 50;

export const listNotificationsDefinition = {
  name: "list-notifications",
  description:
    "Read your Atlassian notifications (the bell icon in Jira), newest first. Notifications are account-wide, " +
    "so Confluence and admin notices appear too unless filtered by product. " +
    "With markAsRead, the returned unread notifications are marked as read afterwards; notifications cannot be " +
    "deleted or dismissed through the API.",
  inputSchema: {
    type: "object",
    properties: {
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

export type ListNotificationsArgs = {
  since?: string;
  until?: string;
  limit?: number;
  unreadOnly?: boolean;
  category?: "direct" | "watching";
  product?: string;
  markAsRead?: boolean;
};

const FEED_QUERY = `query ListNotifications($first: Int, $after: String, $filter: InfluentsNotificationFilter) {
  notifications {
    notificationFeed(first: $first, after: $after, filter: $filter) {
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

const MARK_IDS_READ = `mutation MarkNotificationsRead($ids: [String!]!) {
  notifications { markNotificationsByIdsAsRead(ids: $ids) }
}`;

const MARK_GROUP_READ = `mutation MarkNotificationGroupRead($groupId: String!) {
  notifications { markNotificationsByGroupIdAsRead(groupId: $groupId) }
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

export async function listNotificationsHandler(
  args: ListNotificationsArgs,
  graphql: GraphqlClient = atlassianGraphql(),
  now: Date = new Date(),
): Promise<McpResponse> {
  const {
    since,
    until,
    unreadOnly = false,
    category,
    product,
    markAsRead = false,
  } = args ?? {};

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

  const lines = [
    `${items.length} notification(s)${timeRange}, newest first:`,
    "",
    items.map(formatItem).join("\n\n"),
  ];

  if (markAsRead) {
    lines.push("", await markRead(graphql, items));
  }

  return respond(lines.join("\n"));
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
  // The feed is eventually consistent: a read immediately afterwards can still show them unread.
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
