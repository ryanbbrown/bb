import type { experimental_PluginSidebarThreadProjectionRegion } from "@get-bb/plugin-sdk";
import type { ThreadListEntry } from "@bb/domain";
import {
  createSidebarProjectIdResolver,
  isSidebarProjectThread,
} from "@bb/client-core";

export const SIDEBAR_PROJECTION_MAX_REGIONS = 64;
export const SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES = 50_000;
export const SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES = 10_000;
export const SIDEBAR_PROJECTION_MAX_TEXT_LENGTH = 256;
export const SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH = 320;

export interface SidebarProjectionProjectSnapshot {
  id: string;
}

export interface CanonicalSidebarProjectionProjectGroup {
  projectId: string;
  threadIds: readonly string[];
}

export interface CanonicalSidebarProjectionRegion extends experimental_PluginSidebarThreadProjectionRegion {
  /** Empty unless `grouping.kind === "project"`. Ordered by `projectOrder`. */
  projectGroups: readonly CanonicalSidebarProjectionProjectGroup[];
}

export interface CanonicalSidebarThreadProjection {
  regions: readonly CanonicalSidebarProjectionRegion[];
  excludedThreadIds: readonly string[];
}

export type SidebarThreadProjectionValidationResult =
  | { kind: "valid"; projection: CanonicalSidebarThreadProjection }
  | { kind: "invalid"; reason: string; diagnostic: string };

type ReadResult<T> =
  | { kind: "value"; value: T }
  | { kind: "invalid"; result: SidebarThreadProjectionValidationResult };

/**
 * BB's own sidebar eligibility rule. `visibility` is not part of the plugin
 * thread view, so the host decides this and a projection that references an
 * ineligible thread is rejected rather than silently corrected.
 */
export function isSidebarProjectionEligibleThread(
  thread: ThreadListEntry,
): boolean {
  return (
    thread.archivedAt === null &&
    thread.deletedAt === null &&
    isSidebarProjectThread(thread)
  );
}

function invalid(
  reason: string,
  diagnostic: string,
): SidebarThreadProjectionValidationResult {
  return {
    kind: "invalid",
    reason,
    diagnostic: diagnostic.slice(0, SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readBoundedString(
  value: unknown,
  path: string,
  options: { nonBlank?: boolean } = {},
): ReadResult<string> {
  if (typeof value !== "string") {
    return {
      kind: "invalid",
      result: invalid("invalid-shape", `${path} must be a string.`),
    };
  }
  if (value.length > SIDEBAR_PROJECTION_MAX_TEXT_LENGTH) {
    return {
      kind: "invalid",
      result: invalid(
        "text-limit",
        `${path} exceeds ${SIDEBAR_PROJECTION_MAX_TEXT_LENGTH} characters.`,
      ),
    };
  }
  if (options.nonBlank && value.trim().length === 0) {
    return {
      kind: "invalid",
      result: invalid("blank-value", `${path} must not be blank.`),
    };
  }
  return { kind: "value", value };
}

function readNullableBoundedString(
  value: unknown,
  path: string,
): ReadResult<string | null> {
  if (value === null) return { kind: "value", value: null };
  return readBoundedString(value, path, { nonBlank: true });
}

function readStringArray(
  value: unknown,
  path: string,
  remaining: number,
  limitReason: string,
  limitDiagnostic: string,
): ReadResult<readonly string[]> {
  if (!Array.isArray(value)) {
    return {
      kind: "invalid",
      result: invalid("invalid-shape", `${path} must be an array.`),
    };
  }
  if (value.length > remaining) {
    return { kind: "invalid", result: invalid(limitReason, limitDiagnostic) };
  }
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = readBoundedString(value[index], `${path}[${index}]`);
    if (parsed.kind === "invalid") return parsed;
    result.push(parsed.value);
  }
  return { kind: "value", value: result };
}

function readBoolean(value: unknown, path: string): ReadResult<boolean> {
  if (typeof value !== "boolean") {
    return {
      kind: "invalid",
      result: invalid("invalid-shape", `${path} must be a boolean.`),
    };
  }
  return { kind: "value", value };
}

/**
 * Which project a region's thread belongs to. Native nesting follows the
 * parent chain, so a child renders under the project of the root it nests
 * beneath; a flat region routes every thread to its own project.
 */
function groupRegionThreadsByProject(
  threadOrder: readonly string[],
  threadsById: ReadonlyMap<string, ThreadListEntry>,
  nesting: experimental_PluginSidebarThreadProjectionRegion["nesting"],
): ReadonlyMap<string, string[]> {
  const regionThreadsById = new Map<string, ThreadListEntry>();
  for (const threadId of threadOrder) {
    const thread = threadsById.get(threadId);
    if (thread !== undefined) regionThreadsById.set(threadId, thread);
  }
  const resolveProjectId =
    nesting === "native"
      ? createSidebarProjectIdResolver(regionThreadsById)
      : (thread: ThreadListEntry) => thread.projectId;

  const groups = new Map<string, string[]>();
  for (const thread of regionThreadsById.values()) {
    const threadId = thread.id;
    const projectId = resolveProjectId(thread);
    const group = groups.get(projectId);
    if (group) group.push(threadId);
    else groups.set(projectId, [threadId]);
  }
  return groups;
}

interface RegionValidationContext {
  projectIds: ReadonlySet<string>;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
  visibleThreadIds: Set<string>;
  regionIds: Set<string>;
  budget: { threadReferences: number; projectReferences: number };
  sawFlowRegion: boolean;
}

function validateRegion(
  rawRegion: unknown,
  path: string,
  context: RegionValidationContext,
): ReadResult<CanonicalSidebarProjectionRegion> {
  if (!isRecord(rawRegion)) {
    return {
      kind: "invalid",
      result: invalid("invalid-shape", `${path} must be an object.`),
    };
  }

  const idResult = readBoundedString(rawRegion.id, `${path}.id`, {
    nonBlank: true,
  });
  if (idResult.kind === "invalid") return idResult;
  const id = idResult.value;
  if (context.regionIds.has(id)) {
    return {
      kind: "invalid",
      result: invalid(
        "duplicate-region",
        `Region ID ${id} occurs more than once.`,
      ),
    };
  }
  context.regionIds.add(id);

  const labelResult = readNullableBoundedString(
    rawRegion.label,
    `${path}.label`,
  );
  if (labelResult.kind === "invalid") return labelResult;
  const label = labelResult.value;

  if (rawRegion.placement !== "sticky" && rawRegion.placement !== "flow") {
    return {
      kind: "invalid",
      result: invalid(
        "invalid-discriminant",
        `${path}.placement must be "sticky" or "flow".`,
      ),
    };
  }
  if (rawRegion.placement === "flow") {
    context.sawFlowRegion = true;
  } else if (context.sawFlowRegion) {
    return {
      kind: "invalid",
      result: invalid(
        "sticky-order",
        `Sticky region ${id} follows a flow region.`,
      ),
    };
  }

  const dividerAfterResult = readBoolean(
    rawRegion.dividerAfter,
    `${path}.dividerAfter`,
  );
  if (dividerAfterResult.kind === "invalid") return dividerAfterResult;
  const collapsibleResult = readBoolean(
    rawRegion.collapsible,
    `${path}.collapsible`,
  );
  if (collapsibleResult.kind === "invalid") return collapsibleResult;
  if (label === null && collapsibleResult.value) {
    return {
      kind: "invalid",
      result: invalid(
        "headerless-collapse",
        `${path}.collapsible requires a label.`,
      ),
    };
  }

  if (rawRegion.nesting !== "flat" && rawRegion.nesting !== "native") {
    return {
      kind: "invalid",
      result: invalid(
        "invalid-discriminant",
        `${path}.nesting must be "flat" or "native".`,
      ),
    };
  }
  const nesting = rawRegion.nesting;

  const threadOrderResult = readStringArray(
    rawRegion.threadOrder,
    `${path}.threadOrder`,
    context.budget.threadReferences,
    "thread-limit",
    `Projection exceeds ${SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES} thread references.`,
  );
  if (threadOrderResult.kind === "invalid") return threadOrderResult;
  const threadOrder = threadOrderResult.value;
  context.budget.threadReferences -= threadOrder.length;

  for (const threadId of threadOrder) {
    const thread = context.threadsById.get(threadId);
    if (thread === undefined) {
      return {
        kind: "invalid",
        result: invalid(
          "unknown-thread",
          `Thread ID ${threadId} in region ${id} is stale or unknown.`,
        ),
      };
    }
    if (!isSidebarProjectionEligibleThread(thread)) {
      return {
        kind: "invalid",
        result: invalid(
          "ineligible-thread",
          `Thread ID ${threadId} in region ${id} is not eligible for the sidebar.`,
        ),
      };
    }
    if (context.visibleThreadIds.has(threadId)) {
      return {
        kind: "invalid",
        result: invalid(
          "duplicate-thread",
          `Thread ID ${threadId} occurs in more than one region position.`,
        ),
      };
    }
    context.visibleThreadIds.add(threadId);
  }

  if (!isRecord(rawRegion.grouping)) {
    return {
      kind: "invalid",
      result: invalid("invalid-shape", `${path}.grouping must be an object.`),
    };
  }

  let grouping: experimental_PluginSidebarThreadProjectionRegion["grouping"];
  let projectGroups: CanonicalSidebarProjectionProjectGroup[] = [];

  if (rawRegion.grouping.kind === "none") {
    grouping = { kind: "none" };
  } else if (rawRegion.grouping.kind === "project") {
    const projectOrderResult = readStringArray(
      rawRegion.grouping.projectOrder,
      `${path}.grouping.projectOrder`,
      context.budget.projectReferences,
      "project-limit",
      `Projection exceeds ${SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES} project references.`,
    );
    if (projectOrderResult.kind === "invalid") return projectOrderResult;
    const projectOrder = projectOrderResult.value;
    context.budget.projectReferences -= projectOrder.length;

    const groupCollapsibleResult = readBoolean(
      rawRegion.grouping.collapsible,
      `${path}.grouping.collapsible`,
    );
    if (groupCollapsibleResult.kind === "invalid")
      return groupCollapsibleResult;
    const showEmptyProjectsResult = readBoolean(
      rawRegion.grouping.showEmptyProjects,
      `${path}.grouping.showEmptyProjects`,
    );
    if (showEmptyProjectsResult.kind === "invalid") {
      return showEmptyProjectsResult;
    }

    const seenProjectIds = new Set<string>();
    for (const projectId of projectOrder) {
      if (!context.projectIds.has(projectId)) {
        return {
          kind: "invalid",
          result: invalid(
            "unknown-project",
            `Project ID ${projectId} in region ${id} is unknown.`,
          ),
        };
      }
      if (seenProjectIds.has(projectId)) {
        return {
          kind: "invalid",
          result: invalid(
            "duplicate-project",
            `Project ID ${projectId} occurs twice in region ${id}.`,
          ),
        };
      }
      seenProjectIds.add(projectId);
    }

    grouping = {
      kind: "project",
      projectOrder,
      collapsible: groupCollapsibleResult.value,
      showEmptyProjects: showEmptyProjectsResult.value,
    };

    const grouped = groupRegionThreadsByProject(
      threadOrder,
      context.threadsById,
      nesting,
    );
    for (const representedProjectId of grouped.keys()) {
      if (!seenProjectIds.has(representedProjectId)) {
        return {
          kind: "invalid",
          result: invalid(
            "missing-project-order",
            `Region ${id} holds threads in project ${representedProjectId}, which projectOrder omits.`,
          ),
        };
      }
    }
    projectGroups = projectOrder.flatMap((projectId) => {
      const threadIds = grouped.get(projectId) ?? [];
      return threadIds.length > 0 || showEmptyProjectsResult.value
        ? [{ projectId, threadIds }]
        : [];
    });
  } else {
    return {
      kind: "invalid",
      result: invalid(
        "invalid-discriminant",
        `${path}.grouping.kind must be "none" or "project".`,
      ),
    };
  }

  return {
    kind: "value",
    value: {
      id,
      label,
      placement: rawRegion.placement,
      dividerAfter: dividerAfterResult.value,
      collapsible: collapsibleResult.value,
      nesting,
      grouping,
      threadOrder,
      projectGroups,
    },
  };
}

/**
 * Validate and canonicalize one complete projection against one host snapshot.
 *
 * The projection fully replaces the scroll area, so validation is atomic and
 * strict: every eligible thread must be placed exactly once or excluded
 * explicitly. Anything else fails, and the caller renders BB's own list.
 */
export function validateSidebarThreadProjection({
  projection,
  threads,
  projects,
}: {
  projection: unknown;
  threads: readonly ThreadListEntry[];
  projects: readonly SidebarProjectionProjectSnapshot[];
}): SidebarThreadProjectionValidationResult {
  if (!isRecord(projection)) {
    return invalid("invalid-shape", "Projection must be an object.");
  }
  if (!Array.isArray(projection.regions)) {
    return invalid("invalid-shape", "projection.regions must be an array.");
  }
  if (projection.regions.length > SIDEBAR_PROJECTION_MAX_REGIONS) {
    return invalid(
      "region-limit",
      `Projection exceeds ${SIDEBAR_PROJECTION_MAX_REGIONS} regions.`,
    );
  }

  const projectIds = new Set<string>();
  for (const project of projects) projectIds.add(project.id);
  const threadsById = new Map<string, ThreadListEntry>();
  for (const thread of threads) threadsById.set(thread.id, thread);

  const exclusionsResult = readStringArray(
    projection.excludedThreadIds,
    "projection.excludedThreadIds",
    SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES,
    "thread-limit",
    `Projection exceeds ${SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES} thread references.`,
  );
  if (exclusionsResult.kind === "invalid") return exclusionsResult.result;
  const excludedThreadIds = exclusionsResult.value;

  const context: RegionValidationContext = {
    projectIds,
    threadsById,
    visibleThreadIds: new Set<string>(),
    regionIds: new Set<string>(),
    budget: {
      threadReferences:
        SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES - excludedThreadIds.length,
      projectReferences: SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES,
    },
    sawFlowRegion: false,
  };

  const regions: CanonicalSidebarProjectionRegion[] = [];
  for (let index = 0; index < projection.regions.length; index += 1) {
    const regionResult = validateRegion(
      projection.regions[index],
      `projection.regions[${index}]`,
      context,
    );
    if (regionResult.kind === "invalid") return regionResult.result;
    regions.push(regionResult.value);
  }

  const excludedIds = new Set<string>();
  for (const threadId of excludedThreadIds) {
    const thread = threadsById.get(threadId);
    if (thread === undefined) {
      return invalid(
        "unknown-exclusion",
        `Excluded thread ID ${threadId} is stale or unknown.`,
      );
    }
    if (!isSidebarProjectionEligibleThread(thread)) {
      return invalid(
        "ineligible-exclusion",
        `Excluded thread ID ${threadId} is not eligible for the sidebar.`,
      );
    }
    if (excludedIds.has(threadId)) {
      return invalid(
        "duplicate-exclusion",
        `Excluded thread ID ${threadId} occurs more than once.`,
      );
    }
    if (context.visibleThreadIds.has(threadId)) {
      return invalid(
        "visible-exclusion",
        `Thread ID ${threadId} is both placed in a region and excluded.`,
      );
    }
    excludedIds.add(threadId);
  }

  for (const thread of threads) {
    if (!isSidebarProjectionEligibleThread(thread)) continue;
    if (context.visibleThreadIds.has(thread.id)) continue;
    if (excludedIds.has(thread.id)) continue;
    return invalid(
      "uncovered-thread",
      `Eligible thread ID ${thread.id} is neither placed in a region nor excluded.`,
    );
  }

  return { kind: "valid", projection: { regions, excludedThreadIds } };
}
