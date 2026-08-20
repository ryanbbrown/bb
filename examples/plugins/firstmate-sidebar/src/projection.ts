import type {
  PluginSidebarProject,
  PluginSidebarThread,
  PluginSidebarThreadsState,
} from "@get-bb/plugin-sdk/app";

export interface FirstmateProjectGroup {
  project: PluginSidebarProject;
  threads: PluginSidebarThread[];
}

export interface FirstmateProjection {
  manager: PluginSidebarThread | null;
  managedGroups: FirstmateProjectGroup[];
  independentGroups: FirstmateProjectGroup[];
}

export type ProjectionResult =
  | { kind: "ready"; projection: FirstmateProjection }
  | { kind: "fallback"; reason: string };

export function threadDisplayTitle(thread: PluginSidebarThread): string {
  if (thread.title?.trim()) return thread.title;
  if (thread.titleFallback?.trim()) return thread.titleFallback;
  return `Untitled thread (${thread.id})`;
}

function matchesSearch(thread: PluginSidebarThread, searchQuery: string) {
  const query = searchQuery.trim().toLocaleLowerCase();
  return (
    query.length === 0 ||
    threadDisplayTitle(thread).toLocaleLowerCase().includes(query)
  );
}

function groupByProject(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
): FirstmateProjectGroup[] {
  const threadsByProject = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    const group = threadsByProject.get(thread.projectId);
    if (group) group.push(thread);
    else threadsByProject.set(thread.projectId, [thread]);
  }
  return projects.flatMap((project) => {
    const groupedThreads = threadsByProject.get(project.id);
    return groupedThreads ? [{ project, threads: groupedThreads }] : [];
  });
}

export function projectFirstmateThreads(
  state: PluginSidebarThreadsState,
  managerThreadId: string,
  searchQuery: string,
): ProjectionResult {
  const configuredId = managerThreadId.trim();
  if (!configuredId) {
    return { kind: "fallback", reason: "manager-not-configured" };
  }
  if (state.status !== "ready") {
    return { kind: "fallback", reason: `threads-${state.status}` };
  }

  const threadIds = new Set<string>();
  for (const thread of state.threads) {
    if (threadIds.has(thread.id)) {
      return { kind: "fallback", reason: "thread-not-unique" };
    }
    threadIds.add(thread.id);
  }

  const managerMatches = state.threads.filter(
    (thread) => thread.id === configuredId,
  );
  if (managerMatches.length !== 1) {
    return { kind: "fallback", reason: "manager-not-unique" };
  }
  const manager = managerMatches[0]!;
  if (manager.isArchived) {
    return { kind: "fallback", reason: "manager-archived" };
  }

  const projectIds = new Set<string>();
  for (const project of state.projects) {
    if (projectIds.has(project.id)) {
      return { kind: "fallback", reason: "project-not-unique" };
    }
    if (!project.name.trim()) {
      return { kind: "fallback", reason: "project-name-missing" };
    }
    projectIds.add(project.id);
  }

  const visibleThreads = state.threads.filter((thread) => !thread.isArchived);
  if (visibleThreads.some((thread) => !projectIds.has(thread.projectId))) {
    return { kind: "fallback", reason: "project-missing" };
  }

  const searched = visibleThreads.filter((thread) =>
    matchesSearch(thread, searchQuery),
  );
  const managed = searched.filter(
    (thread) =>
      thread.id !== configuredId && thread.parentThreadId === configuredId,
  );
  const independent = searched.filter(
    (thread) =>
      thread.id !== configuredId && thread.parentThreadId !== configuredId,
  );

  return {
    kind: "ready",
    projection: {
      manager: searched.includes(manager) ? manager : null,
      managedGroups: groupByProject(managed, state.projects),
      independentGroups: groupByProject(independent, state.projects),
    },
  };
}
