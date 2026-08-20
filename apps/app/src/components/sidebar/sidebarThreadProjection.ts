import type {
  PluginSidebarThreadProjection,
  PluginSidebarThreadProjectionRegion,
} from "@get-bb/plugin-sdk";
import { createSidebarProjectIdResolver } from "@bb/client-core";

export const SIDEBAR_PROJECTION_MAX_REGIONS = 64;
export const SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES = 50_000;
export const SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES = 10_000;
export const SIDEBAR_PROJECTION_MAX_TEXT_LENGTH = 256;
export const SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH = 320;

export interface SidebarProjectionThreadSnapshot {
  id: string;
  projectId: string;
  parentThreadId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  visibility: string;
}

export interface SidebarProjectionProjectSnapshot {
  id: string;
}

export interface CanonicalSidebarProjectionProjectGroup {
  projectId: string;
  threadIds: readonly string[];
}

export interface CanonicalSidebarProjectionRegion extends PluginSidebarThreadProjectionRegion {
  projectGroups: readonly CanonicalSidebarProjectionProjectGroup[];
}

export interface CanonicalSidebarThreadProjection extends PluginSidebarThreadProjection {
  regions: readonly CanonicalSidebarProjectionRegion[];
}

export type SidebarThreadProjectionValidationResult =
  | { kind: "valid"; projection: CanonicalSidebarThreadProjection }
  | { kind: "invalid"; reason: string; diagnostic: string };

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

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function readBoundedString(
  value: unknown,
  path: string,
  options: { nullable?: boolean; nonBlank?: boolean } = {},
):
  | { kind: "valid"; value: string | null }
  | { kind: "invalid"; result: SidebarThreadProjectionValidationResult } {
  if (options.nullable && value === null) {
    return { kind: "valid", value: null };
  }
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
  return { kind: "valid", value };
}

function readStringArray(
  value: unknown,
  path: string,
  limit: number,
  limitReason: string,
  limitDiagnostic: string,
):
  | { kind: "valid"; value: readonly string[] }
  | { kind: "invalid"; result: SidebarThreadProjectionValidationResult } {
  if (!Array.isArray(value)) {
    return {
      kind: "invalid",
      result: invalid("invalid-shape", `${path} must be an array.`),
    };
  }
  if (value.length > limit) {
    return {
      kind: "invalid",
      result: invalid(limitReason, limitDiagnostic),
    };
  }
  const result: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = readBoundedString(value[index], `${path}[${index}]`);
    if (parsed.kind === "invalid") return parsed;
    result.push(parsed.value!);
  }
  return { kind: "valid", value: result };
}

function resolveNativeProjectGroups(
  threadIds: readonly string[],
  threadsById: ReadonlyMap<string, SidebarProjectionThreadSnapshot>,
): ReadonlyMap<string, string[]> {
  const regionThreadsById = new Map(
    threadIds.map(
      (threadId) => [threadId, threadsById.get(threadId)!] as const,
    ),
  );
  const resolveProject = createSidebarProjectIdResolver(regionThreadsById);

  const groups = new Map<string, string[]>();
  for (const threadId of threadIds) {
    const thread = regionThreadsById.get(threadId)!;
    const projectId = resolveProject(thread);
    const group = groups.get(projectId);
    if (group) group.push(threadId);
    else groups.set(projectId, [threadId]);
  }
  return groups;
}

export function buildSidebarProjectionCollapseKey({
  pluginId,
  registrationId,
  regionId,
  projectId,
  itemId,
}: {
  pluginId: string;
  registrationId: string;
  regionId: string;
  projectId?: string;
  itemId?: string;
}): string {
  return JSON.stringify([
    "sidebar-projection",
    pluginId,
    registrationId,
    regionId,
    projectId ?? null,
    itemId ?? null,
  ]);
}

/** Validate and canonicalize one complete projection against one host snapshot. */
export function validateSidebarThreadProjection({
  projection,
  threads,
  projects,
}: {
  projection: unknown;
  threads: readonly SidebarProjectionThreadSnapshot[];
  projects: readonly SidebarProjectionProjectSnapshot[];
}): SidebarThreadProjectionValidationResult {
  try {
    if (!isRecord(projection)) {
      return invalid("invalid-shape", "Projection must be an object.");
    }
    if (!Array.isArray(projection.regions)) {
      return invalid("invalid-shape", "projection.regions must be an array.");
    }
    if (projection.regions.length > SIDEBAR_PROJECTION_MAX_REGIONS) {
      return invalid(
        "region-limit",
        `projection.regions exceeds ${SIDEBAR_PROJECTION_MAX_REGIONS} regions.`,
      );
    }
    const exclusionsResult = readStringArray(
      projection.excludedThreadIds,
      "projection.excludedThreadIds",
      SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES,
      "thread-limit",
      `Projection exceeds ${SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES} thread references.`,
    );
    if (exclusionsResult.kind === "invalid") return exclusionsResult.result;

    const projectIds = new Set<string>();
    for (const project of projects) {
      if (projectIds.has(project.id)) {
        return invalid(
          "host-snapshot",
          `Host project ID ${project.id} is duplicated.`,
        );
      }
      projectIds.add(project.id);
    }
    const threadsById = new Map<string, SidebarProjectionThreadSnapshot>();
    for (const thread of threads) {
      if (threadsById.has(thread.id)) {
        return invalid(
          "host-snapshot",
          `Host thread ID ${thread.id} is duplicated.`,
        );
      }
      threadsById.set(thread.id, thread);
    }
    const eligibleIds = new Set(
      threads
        .filter(
          (thread) =>
            thread.archivedAt === null &&
            thread.deletedAt === null &&
            thread.visibility !== "hidden",
        )
        .map((thread) => thread.id),
    );

    let referenceCount = exclusionsResult.value.length;
    let projectReferenceCount = 0;
    let sawFlow = false;
    const regionIds = new Set<string>();
    const visibleIds = new Set<string>();
    const canonicalRegions: CanonicalSidebarProjectionRegion[] = [];

    for (
      let regionIndex = 0;
      regionIndex < projection.regions.length;
      regionIndex += 1
    ) {
      const rawRegion = projection.regions[regionIndex];
      const path = `projection.regions[${regionIndex}]`;
      if (!isRecord(rawRegion))
        return invalid("invalid-shape", `${path} must be an object.`);
      const idResult = readBoundedString(rawRegion.id, `${path}.id`, {
        nonBlank: true,
      });
      if (idResult.kind === "invalid") return idResult.result;
      const id = idResult.value!;
      if (regionIds.has(id))
        return invalid(
          "duplicate-region",
          `Region ID ${id} occurs more than once.`,
        );
      regionIds.add(id);
      const labelResult = readBoundedString(rawRegion.label, `${path}.label`, {
        nullable: true,
        nonBlank: true,
      });
      if (labelResult.kind === "invalid") return labelResult.result;
      if (rawRegion.placement !== "sticky" && rawRegion.placement !== "flow") {
        return invalid(
          "invalid-discriminant",
          `${path}.placement must be "sticky" or "flow".`,
        );
      }
      if (rawRegion.placement === "flow") sawFlow = true;
      else if (sawFlow)
        return invalid(
          "sticky-order",
          `Sticky region ${id} follows a flow region.`,
        );
      if (
        !isBoolean(rawRegion.dividerAfter) ||
        !isBoolean(rawRegion.collapsible)
      ) {
        return invalid("invalid-shape", `${path} boolean fields are invalid.`);
      }
      if (labelResult.value === null && rawRegion.collapsible) {
        return invalid(
          "headerless-collapse",
          `${path}.collapsible must be false when label is null.`,
        );
      }
      if (rawRegion.nesting !== "flat" && rawRegion.nesting !== "native") {
        return invalid(
          "invalid-discriminant",
          `${path}.nesting must be "flat" or "native".`,
        );
      }
      const remainingThreadReferences =
        SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES - referenceCount;
      const threadOrderResult = readStringArray(
        rawRegion.threadOrder,
        `${path}.threadOrder`,
        remainingThreadReferences,
        "thread-limit",
        `Projection exceeds ${SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES} thread references.`,
      );
      if (threadOrderResult.kind === "invalid") return threadOrderResult.result;
      referenceCount += threadOrderResult.value.length;
      if (referenceCount > SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES) {
        return invalid(
          "thread-limit",
          `Projection exceeds ${SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES} thread references.`,
        );
      }

      if (!isRecord(rawRegion.grouping)) {
        return invalid("invalid-shape", `${path}.grouping must be an object.`);
      }
      let grouping: PluginSidebarThreadProjectionRegion["grouping"];
      let projectOrder: readonly string[] = [];
      if (rawRegion.grouping.kind === "none") {
        grouping = { kind: "none" };
      } else if (rawRegion.grouping.kind === "project") {
        const orderResult = readStringArray(
          rawRegion.grouping.projectOrder,
          `${path}.grouping.projectOrder`,
          SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES - projectReferenceCount,
          "project-limit",
          `Projection exceeds ${SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES} project references.`,
        );
        if (orderResult.kind === "invalid") return orderResult.result;
        projectReferenceCount += orderResult.value.length;
        if (projectReferenceCount > SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES) {
          return invalid(
            "project-limit",
            `Projection exceeds ${SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES} project references.`,
          );
        }
        if (
          !isBoolean(rawRegion.grouping.collapsible) ||
          !isBoolean(rawRegion.grouping.showEmptyProjects)
        ) {
          return invalid(
            "invalid-shape",
            `${path}.grouping boolean fields are invalid.`,
          );
        }
        const seenProjects = new Set<string>();
        for (const projectId of orderResult.value) {
          if (!projectIds.has(projectId)) {
            return invalid(
              "unknown-project",
              `Project ID ${projectId} in region ${id} is unknown.`,
            );
          }
          if (seenProjects.has(projectId)) {
            return invalid(
              "duplicate-project",
              `Project ID ${projectId} occurs twice in region ${id}.`,
            );
          }
          seenProjects.add(projectId);
        }
        projectOrder = orderResult.value;
        grouping = {
          kind: "project",
          projectOrder,
          collapsible: rawRegion.grouping.collapsible,
          showEmptyProjects: rawRegion.grouping.showEmptyProjects,
        };
      } else {
        return invalid(
          "invalid-discriminant",
          `${path}.grouping.kind is invalid.`,
        );
      }

      for (const threadId of threadOrderResult.value) {
        const thread = threadsById.get(threadId);
        if (thread === undefined)
          return invalid(
            "unknown-thread",
            `Thread ID ${threadId} in region ${id} is stale or unknown.`,
          );
        if (thread.archivedAt !== null)
          return invalid(
            "archived-thread",
            `Thread ID ${threadId} in region ${id} is archived.`,
          );
        if (thread.deletedAt !== null)
          return invalid(
            "deleted-thread",
            `Thread ID ${threadId} in region ${id} is deleted.`,
          );
        if (thread.visibility === "hidden")
          return invalid(
            "hidden-thread",
            `Thread ID ${threadId} in region ${id} is hidden.`,
          );
        if (visibleIds.has(threadId))
          return invalid(
            "duplicate-thread",
            `Thread ID ${threadId} occurs in more than one visible position.`,
          );
        visibleIds.add(threadId);
      }

      let projectGroups: CanonicalSidebarProjectionProjectGroup[] = [];
      if (grouping.kind === "project") {
        const grouped =
          rawRegion.nesting === "native"
            ? resolveNativeProjectGroups(threadOrderResult.value, threadsById)
            : (() => {
                const result = new Map<string, string[]>();
                for (const threadId of threadOrderResult.value) {
                  const projectId = threadsById.get(threadId)!.projectId;
                  const group = result.get(projectId);
                  if (group) group.push(threadId);
                  else result.set(projectId, [threadId]);
                }
                return result;
              })();
        const orderedProjectIds = new Set(projectOrder);
        for (const representedProjectId of grouped.keys()) {
          if (!orderedProjectIds.has(representedProjectId)) {
            return invalid(
              "missing-project-order",
              `Region ${id} represents project ${representedProjectId}, but projectOrder omits it.`,
            );
          }
        }
        projectGroups = projectOrder.flatMap((projectId) => {
          const threadIds = grouped.get(projectId) ?? [];
          return threadIds.length > 0 || grouping.showEmptyProjects
            ? [{ projectId, threadIds }]
            : [];
        });
      }

      canonicalRegions.push({
        id,
        label: labelResult.value,
        placement: rawRegion.placement,
        dividerAfter: rawRegion.dividerAfter,
        collapsible: rawRegion.collapsible,
        nesting: rawRegion.nesting,
        grouping,
        threadOrder: threadOrderResult.value,
        projectGroups,
      });
    }

    const excludedIds = new Set<string>();
    for (const threadId of exclusionsResult.value) {
      const thread = threadsById.get(threadId);
      if (thread === undefined)
        return invalid(
          "unknown-exclusion",
          `Excluded thread ID ${threadId} is stale or unknown.`,
        );
      if (!eligibleIds.has(threadId))
        return invalid(
          "ineligible-exclusion",
          `Excluded thread ID ${threadId} is not eligible for the sidebar.`,
        );
      if (excludedIds.has(threadId))
        return invalid(
          "duplicate-exclusion",
          `Excluded thread ID ${threadId} occurs more than once.`,
        );
      if (visibleIds.has(threadId))
        return invalid(
          "visible-exclusion",
          `Thread ID ${threadId} is both visible and excluded.`,
        );
      excludedIds.add(threadId);
    }
    for (const threadId of eligibleIds) {
      if (!visibleIds.has(threadId) && !excludedIds.has(threadId)) {
        return invalid(
          "missing-thread",
          `Eligible thread ID ${threadId} is neither visible nor excluded.`,
        );
      }
    }

    const excludedThreadIds = [...exclusionsResult.value];
    return {
      kind: "valid",
      projection: {
        regions: canonicalRegions,
        excludedThreadIds,
      },
    };
  } catch (error) {
    return invalid(
      "invalid-shape",
      `Projection could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
