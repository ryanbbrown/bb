import type {
  PluginSidebarThreadProjection,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";

export type FirstmateProjectionResult =
  | { kind: "ready"; projection: PluginSidebarThreadProjection }
  | { kind: "fallback"; reason: string };

/** Build an ID-only organization request. BB validates it and renders all UI. */
export function projectFirstmateThreads(
  state: PluginSidebarThreadsState,
  managerThreadId: string,
): FirstmateProjectionResult {
  if (
    managerThreadId.length === 0 ||
    managerThreadId.trim() !== managerThreadId ||
    state.status !== "ready"
  ) {
    return { kind: "fallback", reason: "manager-state-unavailable" };
  }

  const seenThreadIds = new Set<string>();
  for (const thread of state.threads) {
    if (seenThreadIds.has(thread.id)) {
      return { kind: "fallback", reason: "thread-id-duplicated" };
    }
    seenThreadIds.add(thread.id);
  }

  const managerMatches = state.threads.filter(
    (thread) => thread.id === managerThreadId,
  );
  if (
    managerMatches.length !== 1 ||
    managerMatches[0]!.isArchived ||
    managerMatches[0]!.visibility !== "visible"
  ) {
    return { kind: "fallback", reason: "manager-unavailable" };
  }

  const projectOrder: string[] = [];
  const seenProjectIds = new Set<string>();
  for (const project of state.projects) {
    if (seenProjectIds.has(project.id)) {
      return { kind: "fallback", reason: "project-id-duplicated" };
    }
    seenProjectIds.add(project.id);
    projectOrder.push(project.id);
  }

  const visibleThreads = state.threads.filter(
    (thread) => thread.visibility === "visible" && !thread.isArchived,
  );
  const managedThreadIds: string[] = [];
  const independentThreadIds: string[] = [];
  for (const thread of visibleThreads) {
    if (thread.id === managerThreadId) continue;
    if (thread.parentThreadId === managerThreadId) {
      managedThreadIds.push(thread.id);
    } else {
      independentThreadIds.push(thread.id);
    }
  }

  return {
    kind: "ready",
    projection: {
      regions: [
        {
          id: "manager",
          label: null,
          placement: "sticky",
          dividerAfter: true,
          collapsible: false,
          nesting: "flat",
          grouping: { kind: "none" },
          threadOrder: [managerThreadId],
        },
        {
          id: "managed-sessions",
          label: "Managed sessions",
          placement: "flow",
          dividerAfter: true,
          collapsible: false,
          nesting: "flat",
          grouping: {
            kind: "project",
            projectOrder,
            collapsible: false,
            showEmptyProjects: false,
          },
          threadOrder: managedThreadIds,
        },
        {
          id: "independent-threads",
          label: "Independent threads",
          placement: "flow",
          dividerAfter: false,
          collapsible: false,
          nesting: "flat",
          grouping: {
            kind: "project",
            projectOrder,
            collapsible: false,
            showEmptyProjects: false,
          },
          threadOrder: independentThreadIds,
        },
      ],
      excludedThreadIds: [],
    },
  };
}
