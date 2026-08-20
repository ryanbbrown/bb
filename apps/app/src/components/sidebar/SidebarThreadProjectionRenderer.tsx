import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import type {
  PluginSidebarThreadProjection,
  PluginSidebarThreadProjectionRegion,
} from "@get-bb/plugin-sdk";
import type { ThreadListEntry } from "@bb/domain";
import { compareCodepoint } from "@bb/client-core";
import type { ProjectResponse } from "@bb/server-contract";
import { toast } from "sonner";
import { SidebarProjectionStickyRegions } from "@/components/ui/sidebar.js";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import {
  usePromptDraftHasInput,
  usePromptDraftInputThreadIds,
} from "@/hooks/usePromptDraftStorage";
import { getCollapsedChildActivity } from "@/lib/thread-activity";
import { SidebarWindowedItems } from "./SidebarWindowedItems";
import { ProjectListShell } from "./ProjectList";
import {
  buildNativeProjectThreadTreeItems,
  ProjectRow,
  ProjectThreadTree,
  ProjectThreadTreeEmptyState,
} from "./ProjectRow";
import { ThreadRow, type ThreadRowOptions } from "./ThreadRow";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import {
  collectProjectThreadItemNavigationEntries,
  countProjectThreadItemRows,
  type ProjectThreadItemRowCountContext,
  type ThreadComparator,
} from "./projectThreadGroups";
import { useSidebarProjectPathInvalidity } from "./useSidebarProjectPathInvalidity";
import { useOpenRootComposeForProject } from "./useOpenRootComposeForProject";
import {
  buildSidebarProjectionCollapseKey,
  validateSidebarThreadProjection,
  type CanonicalSidebarProjectionProjectGroup,
  type CanonicalSidebarProjectionRegion,
} from "./sidebarThreadProjection";

interface SidebarThreadProjectionBinding {
  activeThreadId: string | null;
  generation: number;
  isSearchActive: boolean;
  onNavigate: () => void;
  original: ComponentType;
  pluginId: string;
  registrationId: string;
}

export const SidebarThreadProjectionBindingContext =
  createContext<SidebarThreadProjectionBinding | null>(null);

export const SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES = 128;
const reportedProjectionFailures = new Map<string, true>();

function recordProjectionFailure(key: string): boolean {
  if (reportedProjectionFailures.has(key)) return false;
  reportedProjectionFailures.set(key, true);
  if (
    reportedProjectionFailures.size > SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES
  ) {
    const oldest = reportedProjectionFailures.keys().next().value;
    if (oldest !== undefined) reportedProjectionFailures.delete(oldest);
  }
  return true;
}

export function getSidebarProjectionDiagnosticCountForTest(): number {
  return reportedProjectionFailures.size;
}

export function resetSidebarProjectionDiagnosticsForTest(): void {
  reportedProjectionFailures.clear();
}

function toggleKey(
  current: ReadonlySet<string>,
  key: string,
): ReadonlySet<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

function createRankComparator(threadIds: readonly string[]): ThreadComparator {
  const rank = new Map(threadIds.map((threadId, index) => [threadId, index]));
  return (left, right) =>
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    compareCodepoint(left.id, right.id);
}

const EMPTY_PROJECTS: readonly ProjectResponse[] = [];
const EMPTY_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_REGIONS: readonly CanonicalSidebarProjectionRegion[] = [];
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

const FLAT_THREAD_ROW_OPTIONS: ThreadRowOptions = {
  kind: "default",
  depth: 0,
  isCompact: false,
};
const flatThreadCopies = new WeakMap<ThreadListEntry, ThreadListEntry>();

function asFlatThread(thread: ThreadListEntry): ThreadListEntry {
  if (thread.parentThreadId === null) return thread;
  const cached = flatThreadCopies.get(thread);
  if (cached) return cached;
  const flat = { ...thread, parentThreadId: null };
  flatThreadCopies.set(thread, flat);
  return flat;
}

const ProjectionFlatThreadRow = memo(function ProjectionFlatThreadRow({
  activeThreadId,
  onNavigate,
  thread,
}: {
  activeThreadId: string | null;
  onNavigate: () => void;
  thread: ThreadListEntry;
}) {
  const hasComposerDraft = usePromptDraftHasInput({
    kind: "thread",
    projectId: thread.projectId,
    threadId: thread.id,
  });
  return (
    <ThreadRow
      projectId={thread.projectId}
      thread={thread}
      crossProjectId={null}
      isActive={activeThreadId === thread.id}
      hasComposerDraft={hasComposerDraft}
      onProjectSelect={onNavigate}
      options={FLAT_THREAD_ROW_OPTIONS}
    />
  );
});

const ProjectionFlatThreadRows = memo(function ProjectionFlatThreadRows({
  activeThreadId,
  onNavigate,
  threads,
}: {
  activeThreadId: string | null;
  onNavigate: () => void;
  threads: readonly ThreadListEntry[];
}) {
  const itemKeys = useMemo(() => threads.map((thread) => thread.id), [threads]);
  const alwaysMountedKeys = useMemo(
    () =>
      activeThreadId && itemKeys.includes(activeThreadId)
        ? new Set([activeThreadId])
        : undefined,
    [activeThreadId, itemKeys],
  );
  const estimateRows = useCallback(() => 1, []);
  const getNavigationEntries = useCallback(
    (index: number) => {
      const thread = threads[index];
      return thread
        ? [{ threadId: thread.id, projectId: thread.projectId }]
        : [];
    },
    [threads],
  );
  const renderItem = useCallback(
    (index: number) => {
      const thread = threads[index];
      return thread ? (
        <ProjectionFlatThreadRow
          key={thread.id}
          thread={thread}
          activeThreadId={activeThreadId}
          onNavigate={onNavigate}
        />
      ) : null;
    },
    [activeThreadId, onNavigate, threads],
  );
  return (
    <SidebarWindowedItems
      itemKeys={itemKeys}
      estimateRows={estimateRows}
      getNavigationEntries={getNavigationEntries}
      alwaysMountedKeys={alwaysMountedKeys}
      renderItem={renderItem}
    />
  );
});

interface ProjectionRegionProps {
  activeThreadId: string | null;
  binding: SidebarThreadProjectionBinding;
  collapsedKeys: ReadonlySet<string>;
  invalidLocalPathProjectIds: ReadonlySet<string>;
  onCreateProjectThread: (projectId: string) => void;
  onToggleKey: (key: string) => void;
  projectsById: ReadonlyMap<string, ProjectResponse>;
  region: CanonicalSidebarProjectionRegion;
  showDivider: boolean;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}

const ProjectionProjectGroup = memo(function ProjectionProjectGroup({
  activeThreadId,
  binding,
  collapsedKeys,
  group,
  isLocalPathInvalid,
  nesting,
  onCreateProjectThread,
  onToggleKey,
  project,
  region,
  threadsById,
}: Omit<
  ProjectionRegionProps,
  "invalidLocalPathProjectIds" | "projectsById" | "showDivider"
> & {
  group: CanonicalSidebarProjectionProjectGroup;
  isLocalPathInvalid: boolean;
  nesting: PluginSidebarThreadProjectionRegion["nesting"];
  project: ProjectResponse;
}) {
  const projectCollapseKey = useMemo(
    () =>
      buildSidebarProjectionCollapseKey({
        pluginId: binding.pluginId,
        registrationId: binding.registrationId,
        regionId: region.id,
        projectId: project.id,
        itemId: "project",
      }),
    [binding.pluginId, binding.registrationId, project.id, region.id],
  );
  const groupThreads = useMemo(
    () =>
      group.threadIds.map((threadId) => {
        const thread = threadsById.get(threadId)!;
        return nesting === "flat" ? asFlatThread(thread) : thread;
      }),
    [group.threadIds, nesting, threadsById],
  );
  const threadListState = useMemo(
    () => ({ status: "ready", threads: groupThreads }) as const,
    [groupThreads],
  );
  const comparator = useMemo(
    () => createRankComparator(group.threadIds),
    [group.threadIds],
  );
  const collapsedThreadIds = useMemo(() => {
    const result = new Set<string>();
    for (const thread of groupThreads) {
      const key = buildSidebarProjectionCollapseKey({
        pluginId: binding.pluginId,
        registrationId: binding.registrationId,
        regionId: region.id,
        projectId: thread.projectId,
        itemId: `thread:${thread.id}`,
      });
      if (collapsedKeys.has(key)) result.add(thread.id);
    }
    return result;
  }, [
    binding.pluginId,
    binding.registrationId,
    collapsedKeys,
    groupThreads,
    region.id,
  ]);
  const collapsedEnvironmentIds = useMemo(() => {
    const result = new Set<string>();
    for (const thread of groupThreads) {
      if (thread.environmentId === null) continue;
      const key = buildSidebarProjectionCollapseKey({
        pluginId: binding.pluginId,
        registrationId: binding.registrationId,
        regionId: region.id,
        projectId: project.id,
        itemId: `environment:${thread.environmentId}`,
      });
      if (collapsedKeys.has(key)) result.add(thread.environmentId);
    }
    return result;
  }, [
    binding.pluginId,
    binding.registrationId,
    collapsedKeys,
    groupThreads,
    project.id,
    region.id,
  ]);
  const toggleThread = useCallback(
    (threadId: string) => {
      const thread = threadsById.get(threadId);
      if (!thread) return;
      onToggleKey(
        buildSidebarProjectionCollapseKey({
          pluginId: binding.pluginId,
          registrationId: binding.registrationId,
          regionId: region.id,
          projectId: thread.projectId,
          itemId: `thread:${threadId}`,
        }),
      );
    },
    [
      binding.pluginId,
      binding.registrationId,
      onToggleKey,
      region.id,
      threadsById,
    ],
  );
  const toggleEnvironment = useCallback(
    (environmentId: string) =>
      onToggleKey(
        buildSidebarProjectionCollapseKey({
          pluginId: binding.pluginId,
          registrationId: binding.registrationId,
          regionId: region.id,
          projectId: project.id,
          itemId: `environment:${environmentId}`,
        }),
      ),
    [
      binding.pluginId,
      binding.registrationId,
      onToggleKey,
      project.id,
      region.id,
    ],
  );
  const toggleProject = useCallback(
    () => onToggleKey(projectCollapseKey),
    [onToggleKey, projectCollapseKey],
  );

  return (
    <ProjectRow
      project={project}
      threadListState={threadListState}
      selectedThreadId={activeThreadId ?? undefined}
      isActive={false}
      isCollapsed={
        region.grouping.kind === "project" && region.grouping.collapsible
          ? collapsedKeys.has(projectCollapseKey)
          : false
      }
      isProjectCollapsible={
        region.grouping.kind === "project" && region.grouping.collapsible
      }
      compareThreads={comparator}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      isLocalPathInvalid={isLocalPathInvalid}
      headingTier={region.label === null ? "label" : "project"}
      groupEnvironmentThreads={nesting === "native"}
      onProjectSelect={binding.onNavigate}
      onCreateProjectThread={onCreateProjectThread}
      onToggleProjectCollapsed={toggleProject}
      onToggleThreadCollapsed={toggleThread}
      onToggleEnvironmentCollapsed={toggleEnvironment}
    />
  );
});

interface ProjectionProjectGroupWindowMetadata {
  group: CanonicalSidebarProjectionProjectGroup;
  navigationEntries: readonly { projectId: string; threadId: string }[];
  rows: number;
}

function ProjectionProjectGroups(props: ProjectionRegionProps) {
  const {
    activeThreadId,
    binding,
    collapsedKeys,
    invalidLocalPathProjectIds,
    onCreateProjectThread,
    onToggleKey,
    projectsById,
    region,
    threadsById,
  } = props;
  const groupMetadata = useMemo<ProjectionProjectGroupWindowMetadata[]>(() => {
    return region.projectGroups.map((group) => {
      const projectCollapseKey = buildSidebarProjectionCollapseKey({
        pluginId: binding.pluginId,
        registrationId: binding.registrationId,
        regionId: region.id,
        projectId: group.projectId,
        itemId: "project",
      });
      if (
        region.grouping.kind === "project" &&
        region.grouping.collapsible &&
        collapsedKeys.has(projectCollapseKey)
      ) {
        return { group, navigationEntries: [], rows: 1 };
      }

      const groupThreads = group.threadIds.map((threadId) => {
        const thread = threadsById.get(threadId)!;
        return region.nesting === "flat" ? asFlatThread(thread) : thread;
      });
      const compareThreads = createRankComparator(group.threadIds);
      const collapsedThreadIds = new Set<string>();
      const collapsedEnvironmentIds = new Set<string>();
      for (const thread of groupThreads) {
        const threadCollapseKey = buildSidebarProjectionCollapseKey({
          pluginId: binding.pluginId,
          registrationId: binding.registrationId,
          regionId: region.id,
          projectId: thread.projectId,
          itemId: `thread:${thread.id}`,
        });
        if (collapsedKeys.has(threadCollapseKey)) {
          collapsedThreadIds.add(thread.id);
        }
        if (thread.environmentId !== null) {
          const environmentCollapseKey = buildSidebarProjectionCollapseKey({
            pluginId: binding.pluginId,
            registrationId: binding.registrationId,
            regionId: region.id,
            projectId: group.projectId,
            itemId: `environment:${thread.environmentId}`,
          });
          if (collapsedKeys.has(environmentCollapseKey)) {
            collapsedEnvironmentIds.add(thread.environmentId);
          }
        }
      }
      const rowCountContext: ProjectThreadItemRowCountContext = {
        collapsedThreadIds,
        collapsedEnvironmentIds,
        collapsedSectionKeys: EMPTY_ID_SET,
      };
      const rootItems = buildNativeProjectThreadTreeItems({
        compareThreads,
        draftThreadIds: EMPTY_ID_SET,
        groupEnvironmentThreads: region.nesting === "native",
        threads: groupThreads,
      });
      const navigationEntries = rootItems.flatMap((item) =>
        collectProjectThreadItemNavigationEntries(item, rowCountContext),
      );
      const childRows =
        rootItems.length === 0
          ? 1
          : rootItems.reduce(
              (total, item) =>
                total + countProjectThreadItemRows(item, rowCountContext),
              0,
            );
      return { group, navigationEntries, rows: 1 + childRows };
    });
  }, [
    binding.pluginId,
    binding.registrationId,
    collapsedKeys,
    region,
    threadsById,
  ]);
  const itemKeys = useMemo(
    () => groupMetadata.map(({ group }) => group.projectId),
    [groupMetadata],
  );
  const activeGroupKey = useMemo(() => {
    if (!activeThreadId) return undefined;
    return groupMetadata.find(({ navigationEntries }) =>
      navigationEntries.some((entry) => entry.threadId === activeThreadId),
    )?.group.projectId;
  }, [activeThreadId, groupMetadata]);
  const alwaysMountedKeys = useMemo(
    () => (activeGroupKey ? new Set([activeGroupKey]) : undefined),
    [activeGroupKey],
  );
  const estimateRows = useCallback(
    (index: number) => groupMetadata[index]?.rows ?? 1,
    [groupMetadata],
  );
  const getNavigationEntries = useCallback(
    (index: number) => groupMetadata[index]?.navigationEntries ?? [],
    [groupMetadata],
  );
  const renderItem = useCallback(
    (index: number): ReactNode => {
      const group = groupMetadata[index]?.group;
      if (!group) return null;
      const project = projectsById.get(group.projectId);
      if (!project) return null;
      return (
        <ProjectionProjectGroup
          key={group.projectId}
          activeThreadId={activeThreadId}
          binding={binding}
          collapsedKeys={collapsedKeys}
          group={group}
          isLocalPathInvalid={invalidLocalPathProjectIds.has(group.projectId)}
          nesting={region.nesting}
          onCreateProjectThread={onCreateProjectThread}
          onToggleKey={onToggleKey}
          project={project}
          region={region}
          threadsById={threadsById}
        />
      );
    },
    [
      activeThreadId,
      binding,
      collapsedKeys,
      groupMetadata,
      invalidLocalPathProjectIds,
      onCreateProjectThread,
      onToggleKey,
      projectsById,
      region,
      threadsById,
    ],
  );

  return (
    <SidebarWindowedItems
      itemKeys={itemKeys}
      estimateRows={estimateRows}
      getNavigationEntries={getNavigationEntries}
      alwaysMountedKeys={alwaysMountedKeys}
      renderItem={renderItem}
    />
  );
}

function useRegionThreads(
  region: CanonicalSidebarProjectionRegion,
  threadsById: ReadonlyMap<string, ThreadListEntry>,
): ThreadListEntry[] {
  return useMemo(
    () => region.threadOrder.map((threadId) => threadsById.get(threadId)!),
    [region.threadOrder, threadsById],
  );
}

function ProjectionFlatUngroupedContent({
  activeThreadId,
  binding,
  region,
  threadsById,
}: ProjectionRegionProps) {
  const regionThreads = useRegionThreads(region, threadsById);
  return (
    <ProjectionFlatThreadRows
      threads={regionThreads}
      activeThreadId={activeThreadId}
      onNavigate={binding.onNavigate}
    />
  );
}

function ProjectionNativeUngroupedContent({
  activeThreadId,
  binding,
  collapsedKeys,
  onToggleKey,
  region,
  threadsById,
}: ProjectionRegionProps) {
  const regionThreads = useRegionThreads(region, threadsById);
  const comparator = useMemo(
    () => createRankComparator(region.threadOrder),
    [region.threadOrder],
  );
  const collapsedThreadIds = useMemo(() => {
    const result = new Set<string>();
    for (const thread of regionThreads) {
      if (
        collapsedKeys.has(
          buildSidebarProjectionCollapseKey({
            pluginId: binding.pluginId,
            registrationId: binding.registrationId,
            regionId: region.id,
            projectId: thread.projectId,
            itemId: `thread:${thread.id}`,
          }),
        )
      ) {
        result.add(thread.id);
      }
    }
    return result;
  }, [binding, collapsedKeys, region.id, regionThreads]);
  const collapsedEnvironmentIds = useMemo(() => {
    const result = new Set<string>();
    for (const thread of regionThreads) {
      if (
        thread.environmentId !== null &&
        collapsedKeys.has(
          buildSidebarProjectionCollapseKey({
            pluginId: binding.pluginId,
            registrationId: binding.registrationId,
            regionId: region.id,
            projectId: thread.projectId,
            itemId: `environment:${thread.environmentId}`,
          }),
        )
      ) {
        result.add(thread.environmentId);
      }
    }
    return result;
  }, [binding, collapsedKeys, region.id, regionThreads]);
  const threadListState = useMemo(
    () => ({ status: "ready", threads: regionThreads }) as const,
    [regionThreads],
  );
  const toggleThread = useCallback(
    (threadId: string) => {
      const thread = threadsById.get(threadId);
      if (!thread) return;
      onToggleKey(
        buildSidebarProjectionCollapseKey({
          pluginId: binding.pluginId,
          registrationId: binding.registrationId,
          regionId: region.id,
          projectId: thread.projectId,
          itemId: `thread:${threadId}`,
        }),
      );
    },
    [binding, onToggleKey, region.id, threadsById],
  );
  const toggleEnvironment = useCallback(
    (environmentId: string) => {
      const thread = regionThreads.find(
        (candidate) => candidate.environmentId === environmentId,
      );
      if (!thread) return;
      onToggleKey(
        buildSidebarProjectionCollapseKey({
          pluginId: binding.pluginId,
          registrationId: binding.registrationId,
          regionId: region.id,
          projectId: thread.projectId,
          itemId: `environment:${environmentId}`,
        }),
      );
    },
    [binding, onToggleKey, region.id, regionThreads],
  );

  return (
    <ProjectThreadTree
      threadListState={threadListState}
      compareThreads={comparator}
      variant="section"
      selectedThreadId={activeThreadId ?? undefined}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={binding.onNavigate}
      onToggleThreadCollapsed={toggleThread}
      onToggleEnvironmentCollapsed={toggleEnvironment}
    />
  );
}

function ProjectionUngroupedContent(props: ProjectionRegionProps) {
  return props.region.nesting === "flat" ? (
    <ProjectionFlatUngroupedContent {...props} />
  ) : (
    <ProjectionNativeUngroupedContent {...props} />
  );
}

function ProjectionRegionContent(props: ProjectionRegionProps) {
  return props.region.grouping.kind === "project" ? (
    <ProjectionProjectGroups {...props} />
  ) : (
    <ProjectionUngroupedContent {...props} />
  );
}

function CollapsibleProjectionRegion(props: ProjectionRegionProps) {
  const { binding, collapsedKeys, onToggleKey, region, threadsById } = props;
  const regionThreads = useRegionThreads(region, threadsById);
  const draftThreadIds = usePromptDraftInputThreadIds(regionThreads);
  const collapsedActivity = useMemo(
    () => getCollapsedChildActivity(regionThreads, draftThreadIds),
    [draftThreadIds, regionThreads],
  );
  const regionCollapseKey = useMemo(
    () =>
      buildSidebarProjectionCollapseKey({
        pluginId: binding.pluginId,
        registrationId: binding.registrationId,
        regionId: region.id,
        itemId: "region",
      }),
    [binding.pluginId, binding.registrationId, region.id],
  );
  const toggleRegion = useCallback(
    () => onToggleKey(regionCollapseKey),
    [onToggleKey, regionCollapseKey],
  );
  return (
    <TopLevelSidebarSection
      label={region.label!}
      headingLevel={2}
      labelHierarchy="region"
      collapseControl={{
        isCollapsed: collapsedKeys.has(regionCollapseKey),
        onToggleCollapsed: toggleRegion,
      }}
      collapsedActivity={collapsedActivity}
      collapsedThreads={regionThreads}
    >
      <ProjectionRegionContent {...props} />
    </TopLevelSidebarSection>
  );
}

function ProjectionRegion(props: ProjectionRegionProps) {
  const { region, showDivider } = props;
  let content: ReactNode;
  if (region.label === null) {
    content = <ProjectionRegionContent {...props} />;
  } else if (region.collapsible) {
    content = <CollapsibleProjectionRegion {...props} />;
  } else {
    content = (
      <TopLevelSidebarSection
        label={region.label}
        headingLevel={2}
        labelHierarchy="region"
      >
        <ProjectionRegionContent {...props} />
      </TopLevelSidebarSection>
    );
  }
  return (
    <div data-sidebar-projection-region={region.id}>
      {content}
      {showDivider ? (
        <div role="separator" className="my-2 h-px bg-sidebar-border" />
      ) : null}
    </div>
  );
}

/** Module-stable, sidebar-instance-bound native projection renderer. */
export function BoundSidebarThreadProjection({
  projection,
}: {
  projection: PluginSidebarThreadProjection;
}) {
  const binding = useContext(SidebarThreadProjectionBindingContext)!;
  return (
    <SidebarThreadProjectionHost binding={binding} projection={projection} />
  );
}

function regionHasRenderableContent(
  region: CanonicalSidebarProjectionRegion,
): boolean {
  return region.threadOrder.length > 0 || region.projectGroups.length > 0;
}

function SidebarThreadProjectionHost({
  binding,
  projection,
}: {
  binding: SidebarThreadProjectionBinding;
  projection: PluginSidebarThreadProjection;
}) {
  const navigationQuery = useSidebarNavigation();
  const onCreateProjectThread = useOpenRootComposeForProject(
    binding.onNavigate,
  );
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onToggleKey = useCallback(
    (key: string) => setCollapsedKeys((current) => toggleKey(current, key)),
    [],
  );
  const data = navigationQuery.data;
  const hostSnapshot = useMemo(() => {
    if (!data) return null;
    const projects = [
      ...data.projects.map(stripProjectThreads),
      stripProjectThreads(data.personalProject),
    ];
    const threads = [
      ...data.projects.flatMap((project) => project.threads),
      ...data.personalProject.threads,
    ];
    return { projects, threads };
  }, [data]);
  const validation = useMemo(
    () =>
      hostSnapshot
        ? validateSidebarThreadProjection({
            projection,
            threads: hostSnapshot.threads,
            projects: hostSnapshot.projects,
          })
        : null,
    [hostSnapshot, projection],
  );

  useEffect(() => {
    if (binding.isSearchActive || validation?.kind !== "invalid") return;
    const failureKey = `${binding.pluginId}/${binding.generation}/${validation.reason}`;
    if (!recordProjectionFailure(failureKey)) return;
    const description = `${binding.pluginId}: ${validation.diagnostic}`;
    console.warn(`Invalid sidebar thread projection — ${description}`);
    toast.error("Sidebar projection was invalid", { description });
  }, [
    binding.generation,
    binding.isSearchActive,
    binding.pluginId,
    validation,
  ]);

  const snapshotThreads = hostSnapshot?.threads ?? EMPTY_THREADS;
  const snapshotProjects = hostSnapshot?.projects ?? EMPTY_PROJECTS;
  const canonicalRegions =
    validation?.kind === "valid"
      ? validation.projection.regions
      : EMPTY_REGIONS;
  const threadsById = useMemo(
    () =>
      new Map(snapshotThreads.map((thread) => [thread.id, thread] as const)),
    [snapshotThreads],
  );
  const projectsById = useMemo(
    () =>
      new Map(
        snapshotProjects.map((project) => [project.id, project] as const),
      ),
    [snapshotProjects],
  );
  const invalidLocalPathProjectIds =
    useSidebarProjectPathInvalidity(snapshotProjects);
  const survivingRegions = useMemo(
    () => canonicalRegions.filter(regionHasRenderableContent),
    [canonicalRegions],
  );
  const stickyRegions = useMemo(
    () => survivingRegions.filter((region) => region.placement === "sticky"),
    [survivingRegions],
  );
  const flowRegions = useMemo(
    () => survivingRegions.filter((region) => region.placement === "flow"),
    [survivingRegions],
  );
  const lastRegionId = survivingRegions.at(-1)?.id;
  const renderRegion = useCallback(
    (region: CanonicalSidebarProjectionRegion): ReactNode => (
      <ProjectionRegion
        key={region.id}
        activeThreadId={binding.activeThreadId}
        binding={binding}
        collapsedKeys={collapsedKeys}
        invalidLocalPathProjectIds={invalidLocalPathProjectIds}
        onCreateProjectThread={onCreateProjectThread}
        onToggleKey={onToggleKey}
        projectsById={projectsById}
        region={region}
        showDivider={region.dividerAfter && region.id !== lastRegionId}
        threadsById={threadsById}
      />
    ),
    [
      binding,
      collapsedKeys,
      invalidLocalPathProjectIds,
      lastRegionId,
      onCreateProjectThread,
      onToggleKey,
      projectsById,
      threadsById,
    ],
  );

  const Original = binding.original;
  if (
    binding.isSearchActive ||
    hostSnapshot === null ||
    validation?.kind !== "valid"
  ) {
    return <Original />;
  }

  return (
    <ProjectListShell>
      {survivingRegions.length === 0 ? (
        <ProjectThreadTreeEmptyState status="ready" variant="section" />
      ) : (
        <>
          {stickyRegions.length > 0 ? (
            <SidebarProjectionStickyRegions>
              {stickyRegions.map(renderRegion)}
            </SidebarProjectionStickyRegions>
          ) : null}
          {flowRegions.map(renderRegion)}
        </>
      )}
    </ProjectListShell>
  );
}
