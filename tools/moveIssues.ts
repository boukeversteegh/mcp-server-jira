import { Version3Client } from "jira.js";
import type { McpResponse } from "../utils.js";
import { fail, formatJiraError, respond } from "../utils.js";

// Field names accepted for a type change, and the extra key allowed alongside it.
const TYPE_KEYS = ["issuetype", "issueType", "type"];
const PARENT_KEYS = ["parent", "parentKey"];

export interface MoveRequest {
  issueType: string;
  parentKey?: string;
}

/**
 * Detect whether an update entry is a "move" (issue type change).
 * Returns null when no type field is present.
 */
export function detectMove(
  fields: Record<string, any>,
): { move: MoveRequest } | { error: string } | null {
  const keys = Object.keys(fields);
  const typeKey = keys.find((k) => TYPE_KEYS.includes(k));
  if (!typeKey) return null;

  const otherKeys = keys.filter(
    (k) => k !== typeKey && !PARENT_KEYS.includes(k),
  );
  if (otherKeys.length > 0) {
    return {
      error:
        `Changing the issue type cannot be combined with other field updates. ` +
        `Remove ${otherKeys.join(", ")} from this entry and send them as a separate update entry ` +
        `(only "${typeKey}" and optionally "parent"/"parentKey" are allowed here).`,
    };
  }

  const issueType = readName(fields[typeKey]);
  if (!issueType) {
    return {
      error: `"${typeKey}" must be an issue type name, e.g. "Bug", or {"name": "Bug"}.`,
    };
  }

  const parentKey = PARENT_KEYS.map((k) => readName(fields[k])).find((v) => v);

  return { move: { issueType, ...(parentKey ? { parentKey } : {}) } };
}

function readName(value: any): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const raw = value.name ?? value.key ?? value.value;
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return undefined;
}

// ── Execution ─────────────────────────────────────────────────────────────────
//
// Jira's plain PUT /issue endpoint refuses issue-type changes ("issue type
// selected is invalid"). The only way to actually change an issue's type is
// the async Bulk Move API (POST /rest/api/3/bulk/issues/move, exposed here as
// jira.issueBulkOperations.submitBulkMove), which returns a taskId that must
// be polled via getBulkOperationProgress. We let Jira infer field/status/
// classification defaults rather than mapping them ourselves.

interface IssueSnapshot {
  key: string;
  id: string;
  projectKey: string;
  currentTypeId: string;
  currentTypeName: string;
  parentKey?: string;
}

interface MoveGroup {
  mappingKey: string;
  targetTypeName: string;
  issueKeys: string[];
}

const TERMINAL_STATUSES = ["COMPLETE", "FAILED", "CANCELLED", "DEAD"];
// ~10 polls, growing backoff, ~36s total before we give up and report "still processing".
const POLL_DELAYS_MS = [
  1000, 1500, 2000, 3000, 4000, 5000, 5000, 5000, 5000, 5000,
];

/**
 * Change the issue type of one or more issues (the Jira "Move" operation).
 */
export async function moveIssuesCore(
  jira: Version3Client,
  issueKeys: string[],
  request: MoveRequest,
): Promise<McpResponse> {
  const { issueType, parentKey } = request;
  const typesByProject = new Map<string, any[]>();

  const unchanged: string[] = [];
  const failLines: string[] = [];
  const successLines: string[] = [];
  const snapshots: IssueSnapshot[] = [];
  const idToKey = new Map<string, string>();

  // 1. Snapshot current state of every issue.
  for (const issueKey of issueKeys) {
    try {
      const issue = await jira.issues.getIssue({
        issueIdOrKey: issueKey,
        fields: ["project", "issuetype", "parent"],
      });
      const projectKey = issue.fields.project?.key;
      if (!projectKey)
        throw new Error(`could not determine the project of ${issueKey}`);

      const snapshot: IssueSnapshot = {
        key: issueKey,
        id: issue.id,
        projectKey,
        currentTypeId: issue.fields.issuetype?.id ?? "",
        currentTypeName: issue.fields.issuetype?.name ?? "unknown",
        parentKey: (issue.fields as any).parent?.key,
      };
      snapshots.push(snapshot);
      idToKey.set(issue.id, issueKey);
    } catch (e: any) {
      failLines.push(
        `${issueKey}: ${formatJiraError("could not read issue", e)}`,
      );
    }
  }

  // 2. Resolve the target type per project and group issues that move to the
  //    same destination (project + type + parent) into one API call each.
  const groups = new Map<string, MoveGroup>();

  for (const snap of snapshots) {
    const available = await getIssueTypes(
      jira,
      typesByProject,
      snap.projectKey,
    );
    const target = available.find(
      (it) => it.name?.toLowerCase() === issueType.toLowerCase(),
    );
    if (!target) {
      failLines.push(
        `${snap.key}: issue type "${issueType}" is not available in project ${snap.projectKey}. ` +
          `Available: ${available.map((it) => it.name).join(", ") || "none"}`,
      );
      continue;
    }

    const parentUnchanged = !parentKey || parentKey === snap.parentKey;
    if (target.id === snap.currentTypeId && parentUnchanged) {
      unchanged.push(
        `${snap.key}: already of type ${snap.currentTypeName} (unchanged)`,
      );
      continue;
    }

    const newParent =
      parentKey ?? (target.subtask ? snap.parentKey : undefined);
    if (target.subtask && !newParent) {
      failLines.push(
        `${snap.key}: "${target.name}" is a sub-task type, so a parent is required. ` +
          `Add "parentKey" to the same update entry.`,
      );
      continue;
    }

    const mappingKey = `${snap.projectKey},${target.id}${newParent ? `,${newParent}` : ""}`;
    // Keep each group's source issues on a single current type/parent too —
    // Jira's docs describe bulk move as one project/type/parent per request.
    const groupKey = `${mappingKey}::${snap.currentTypeId}::${snap.parentKey ?? ""}`;

    let group = groups.get(groupKey);
    if (!group) {
      group = { mappingKey, targetTypeName: target.name, issueKeys: [] };
      groups.set(groupKey, group);
    }
    group.issueKeys.push(snap.key);
  }

  // 3. Submit one bulk move per group and wait for it to finish.
  for (const group of groups.values()) {
    try {
      const submitted: any = await jira.issueBulkOperations.submitBulkMove({
        sendBulkNotification: false,
        targetToSourcesMapping: {
          [group.mappingKey]: {
            issueIdsOrKeys: group.issueKeys,
            inferClassificationDefaults: true,
            inferFieldDefaults: true,
            inferStatusDefaults: true,
            inferSubtaskTypeDefault: true,
          },
        },
      } as any);

      const taskId = submitted?.taskId;
      if (!taskId)
        throw new Error("Jira did not return a task ID for the bulk move.");

      const progress = await pollBulkMove(jira, taskId);
      reportGroupOutcome(group, progress, idToKey, successLines, failLines);
    } catch (e: any) {
      for (const key of group.issueKeys) {
        failLines.push(
          `${key}: ${formatJiraError(`move to ${group.targetTypeName} failed`, e)}`,
        );
      }
    }
  }

  const sections: string[] = [];
  if (successLines.length) sections.push(`Moved:\n${successLines.join("\n")}`);
  if (unchanged.length) sections.push(`Unchanged:\n${unchanged.join("\n")}`);
  if (failLines.length) sections.push(`Failed:\n${failLines.join("\n")}`);

  if (!sections.length) return respond("No issues processed.");

  const nothingSucceeded = successLines.length === 0 && unchanged.length === 0;
  return nothingSucceeded
    ? fail(sections.join("\n\n"))
    : respond(sections.join("\n\n"));
}

async function getIssueTypes(
  jira: Version3Client,
  cache: Map<string, any[]>,
  projectKey: string,
): Promise<any[]> {
  const cached = cache.get(projectKey);
  if (cached) return cached;

  const meta = await jira.issues.getCreateIssueMeta({
    projectKeys: [projectKey],
    expand: "projects.issuetypes",
  });
  const types = (meta as any).projects?.[0]?.issuetypes ?? [];
  cache.set(projectKey, types);
  return types;
}

async function pollBulkMove(
  jira: Version3Client,
  taskId: string,
): Promise<any> {
  for (const delay of POLL_DELAYS_MS) {
    const progress: any =
      await jira.issueBulkOperations.getBulkOperationProgress({
        taskId,
      } as any);
    if (TERMINAL_STATUSES.includes(progress?.status)) return progress;
    await sleep(delay);
  }
  // One last check after the final wait, whatever it reports is what we surface.
  return await jira.issueBulkOperations.getBulkOperationProgress({
    taskId,
  } as any);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportGroupOutcome(
  group: MoveGroup,
  progress: any,
  idToKey: Map<string, string>,
  successLines: string[],
  failLines: string[],
): void {
  if (!progress?.status) {
    failLines.push(
      `${group.issueKeys.join(", ")}: move to ${group.targetTypeName} — no status returned by Jira.`,
    );
    return;
  }

  if (progress.status === "COMPLETE") {
    const failedMap: Record<string, any> =
      progress.failedAccessibleIssues &&
      typeof progress.failedAccessibleIssues === "object"
        ? progress.failedAccessibleIssues
        : {};
    const failedIds = Object.keys(failedMap);
    const failedKeys = new Set(failedIds.map((id) => idToKey.get(id) ?? id));
    const succeededKeys = group.issueKeys.filter((k) => !failedKeys.has(k));

    if (succeededKeys.length) {
      successLines.push(`${succeededKeys.join(", ")}: ${group.targetTypeName}`);
    }
    for (const id of failedIds) {
      const key = idToKey.get(id) ?? id;
      const reason = Array.isArray(failedMap[id])
        ? failedMap[id].join("; ")
        : String(failedMap[id]);
      failLines.push(
        `${key}: move to ${group.targetTypeName} failed: ${reason}`,
      );
    }
    return;
  }

  if (TERMINAL_STATUSES.includes(progress.status)) {
    failLines.push(
      `${group.issueKeys.join(", ")}: move to ${group.targetTypeName} ${progress.status.toLowerCase()} (task ${progress.taskId}).`,
    );
    return;
  }

  failLines.push(
    `${group.issueKeys.join(", ")}: move to ${group.targetTypeName} still ${progress.status.toLowerCase()} — ` +
      `check Jira task ${progress.taskId} later.`,
  );
}
