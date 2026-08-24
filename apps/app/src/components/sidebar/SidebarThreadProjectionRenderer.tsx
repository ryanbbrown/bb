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
import { useAtom } from "jotai";
import { toast } from "sonner";
import { EmptyState } from "@bb/shared-ui/empty-state";
import type { ThreadListEntry } from "@bb/domain";
import type { experimental_PluginSidebarThreadProjection } from "@get-bb/plugin-sdk";
import {
  buildChronologicalThreadList,
  collectProjectThreadItemNavigationEntries,
  compareCodepoint,
  countProjectThreadItemRows,
  getCollapsedChildActivity,
  projectThreadItemContainsThread,
  type ProjectThreadItem,
  type ProjectThreadItemRowCountContext,
  type ThreadComparator,
} from "@bb/client-core";
import { SidebarGroupContent } from "@/components/ui/sidebar.js";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  stripProjectThreads,
  type SidebarProject,
} from "@/hooks/queries/project-queries";
import { usePromptDraftInputThreadIds } from "@/hooks/usePromptDraftStorage";
import { ProjectListShell, SidebarDisplayOptionsMenu } from "./ProjectList";
import { ThreadTreeNodeRow } from "./ProjectRow";
import { SidebarWindowedItems } from "./SidebarWindowedItems";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import {
  collapsedEnvironmentIdsAtom,
  collapsedThreadIdsAtom,
} from "./sidebarCollapsedAtoms";
import {
  isSidebarProjectionEligibleThread,
  validateSidebarThreadProjection,
  type CanonicalSidebarProjectionProjectGroup,
  type CanonicalSidebarProjectionRegion,
} from "./sidebarThreadProjection";

/**
 * Everything the renderer needs from the sidebar instance and the thread-list
 * registration that submitted the projection. `PluginThreadList` supplies it;
 * the component a plugin receives stays module-stable so submitting a new
 * projection never remounts the sidebar.
 */
export interface SidebarThreadProjectionBinding {
  activeThreadId: string | null;
  generation: number;
  isSearchFieldOpen: boolean;
  onNavigate: () => void;
  Original: ComponentType;
  pluginId: string;
  registrationId: string;
}

const SidebarThreadProjectionBindingContext =
  createContext<SidebarThreadProjectionBinding | null>(null);

export function SidebarThreadProjectionBindingProvider({
  activeThreadId,
  children,
  generation,
  isSearchFieldOpen,
  onNavigate,
  Original,
  pluginId,
  registrationId,
}: SidebarThreadProjectionBinding & { children: ReactNode }) {
  const binding = useMemo<SidebarThreadProjectionBinding>(
    () => ({
      activeThreadId,
      generation,
      isSearchFieldOpen,
      onNavigate,
      Original,
      pluginId,
      registrationId,
    }),
    [
      activeThreadId,
      generation,
      isSearchFieldOpen,
      onNavigate,
      Original,
      pluginId,
      registrationId,
    ],
  );
  return (
    <SidebarThreadProjectionBindingContext.Provider value={binding}>
      {children}
    </SidebarThreadProjectionBindingContext.Provider>
  );
}

const SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES = 128;
const reportedProjectionFailures = new Set<string>();

/** Report one plugin/generation/reason combination at most once. */
function shouldReportProjectionFailure(key: string): boolean {
  if (reportedProjectionFailures.has(key)) return false;
  if (
    reportedProjectionFailures.size >= SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES
  ) {
    const oldest = reportedProjectionFailures.values().next().value;
    if (oldest !== undefined) reportedProjectionFailures.delete(oldest);
  }
  reportedProjectionFailures.add(key);
  return true;
}

export function resetSidebarProjectionDiagnosticsForTest(): void {
  reportedProjectionFailures.clear();
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set<string>();
const EMPTY_THREADS: readonly ThreadListEntry[] = [];
const EMPTY_PROJECTS: readonly SidebarProject[] = [];
const EMPTY_REGIONS: readonly CanonicalSidebarProjectionRegion[] = [];

/** Orders threads by their position in the region, ties broken deterministically. */
function createRankComparator(threadIds: readonly string[]): ThreadComparator {
  const rank = new Map(threadIds.map((threadId, index) => [threadId, index]));
  return (left, right) =>
    (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
    compareCodepoint(left.id, right.id);
}

// A flat region renders every thread as a root row, so the copies it feeds the
// native tree builder drop their parent link. Cached per entry so a re-render
// with unchanged data keeps the same object identities the row memos compare.
const flatThreadCopies = new WeakMap<ThreadListEntry, ThreadListEntry>();

function asRootThread(thread: ThreadListEntry): ThreadListEntry {
  if (thread.parentThreadId === null) return thread;
  const cached = flatThreadCopies.get(thread);
  if (cached) return cached;
  const flat: ThreadListEntry = { ...thread, parentThreadId: null };
  flatThreadCopies.set(thread, flat);
  return flat;
}

function useRegionThreadItems({
  nesting,
  threadIds,
  threadsById,
}: {
  nesting: CanonicalSidebarProjectionRegion["nesting"];
  threadIds: readonly string[];
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}): ProjectThreadItem[] {
  const threads = useMemo(() => {
    const result: ThreadListEntry[] = [];
    for (const threadId of threadIds) {
      const thread = threadsById.get(threadId);
      if (thread === undefined) continue;
      result.push(nesting === "flat" ? asRootThread(thread) : thread);
    }
    return result;
  }, [nesting, threadIds, threadsById]);
  const draftThreadIds = usePromptDraftInputThreadIds(threads);
  const compareThreads = useMemo(
    () => createRankComparator(threadIds),
    [threadIds],
  );
  // Worktree environment grouping is deliberately absent: it emits group items
  // that no exported row component can render, which would drop their threads.
  return useMemo(
    () => buildChronologicalThreadList(threads, compareThreads, draftThreadIds),
    [compareThreads, draftThreadIds, threads],
  );
}

interface ProjectionRowsProps {
  activeThreadId: string | null;
  collapsedEnvironmentIds: Set<string>;
  collapsedThreadIds: Set<string>;
  items: readonly ProjectThreadItem[];
  onNavigate: () => void;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
  /** Route every row here, or null to route each row to its own project. */
  projectId: string | null;
}

/**
 * The projection's stand-in for the sidebar's private thread-item mapper.
 * Every row, including each subtree, is still rendered by `ThreadTreeNodeRow`.
 */
const ProjectionRows = memo(function ProjectionRows({
  activeThreadId,
  collapsedEnvironmentIds,
  collapsedThreadIds,
  items,
  onNavigate,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  projectId,
}: ProjectionRowsProps) {
  const rowCountContext = useMemo<ProjectThreadItemRowCountContext>(
    () => ({
      collapsedThreadIds,
      collapsedEnvironmentIds,
      collapsedSectionKeys: EMPTY_ID_SET,
    }),
    [collapsedEnvironmentIds, collapsedThreadIds],
  );
  const itemKeys = useMemo(() => items.map(getProjectionItemKey), [items]);
  const estimateRows = useCallback(
    (index: number) => {
      const item = items[index];
      return item ? countProjectThreadItemRows(item, rowCountContext) : 1;
    },
    [items, rowCountContext],
  );
  const getNavigationEntries = useCallback(
    (index: number) => {
      const item = items[index];
      return item
        ? collectProjectThreadItemNavigationEntries(item, rowCountContext)
        : [];
    },
    [items, rowCountContext],
  );
  const alwaysMountedKeys = useMemo(() => {
    if (activeThreadId === null) return undefined;
    const activeItem = items.find((item) =>
      projectThreadItemContainsThread(item, activeThreadId),
    );
    return activeItem ? new Set([getProjectionItemKey(activeItem)]) : undefined;
  }, [activeThreadId, items]);
  const renderItem = useCallback(
    (index: number): ReactNode => {
      const item = items[index];
      if (item === undefined || item.kind !== "thread") return null;
      return (
        <ThreadTreeNodeRow
          key={item.node.thread.id}
          projectId={projectId ?? item.node.thread.projectId}
          node={item.node}
          depthOffset={0}
          isEnvGrouped={false}
          selectedThreadId={activeThreadId ?? undefined}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          variant="section"
          onProjectSelect={onNavigate}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      );
    },
    [
      activeThreadId,
      collapsedEnvironmentIds,
      collapsedThreadIds,
      items,
      onNavigate,
      onToggleEnvironmentCollapsed,
      onToggleThreadCollapsed,
      projectId,
    ],
  );

  if (items.length === 0) {
    return <ProjectionEmptyState />;
  }

  return (
    <div
      data-sidebar-sticky-section=""
      className="relative space-y-0.5 group-data-[collapsible=icon]:hidden"
    >
      <SidebarWindowedItems
        itemKeys={itemKeys}
        estimateRows={estimateRows}
        getNavigationEntries={getNavigationEntries}
        {...(alwaysMountedKeys ? { alwaysMountedKeys } : {})}
        renderItem={renderItem}
      />
    </div>
  );
});

function getProjectionItemKey(item: ProjectThreadItem): string {
  switch (item.kind) {
    case "thread":
      return `thread:${item.node.thread.id}`;
    case "environment":
      return `env:${item.group.environmentId}`;
    case "section":
      return `section:${item.group.key}`;
  }
}

function ProjectionEmptyState() {
  return (
    <EmptyState
      message="No threads"
      icon="MessageSquare"
      className="px-2 py-0.5 group-data-[collapsible=icon]:hidden"
      iconClassName="size-3.5 text-subtle-foreground/50"
      messageClassName="text-xs leading-4 text-subtle-foreground/60"
    />
  );
}

interface ProjectionCollapseState {
  collapsedEnvironmentIds: Set<string>;
  collapsedKeys: ReadonlySet<string>;
  collapsedThreadIds: Set<string>;
  onToggleEnvironmentCollapsed: (environmentId: string) => void;
  onToggleKey: (key: string) => void;
  onToggleThreadCollapsed: (threadId: string) => void;
}

interface ProjectionRegionProps {
  activeThreadId: string | null;
  collapse: ProjectionCollapseState;
  onNavigate: () => void;
  projectNamesById: ReadonlyMap<string, string>;
  region: CanonicalSidebarProjectionRegion;
  showDivider: boolean;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}

function ProjectionUngroupedRegionBody({
  activeThreadId,
  collapse,
  onNavigate,
  region,
  threadsById,
}: Omit<ProjectionRegionProps, "projectNamesById" | "showDivider">) {
  const items = useRegionThreadItems({
    nesting: region.nesting,
    threadIds: region.threadOrder,
    threadsById,
  });
  return (
    <ProjectionRows
      activeThreadId={activeThreadId}
      collapsedEnvironmentIds={collapse.collapsedEnvironmentIds}
      collapsedThreadIds={collapse.collapsedThreadIds}
      items={items}
      onNavigate={onNavigate}
      onToggleEnvironmentCollapsed={collapse.onToggleEnvironmentCollapsed}
      onToggleThreadCollapsed={collapse.onToggleThreadCollapsed}
      projectId={null}
    />
  );
}

function ProjectionProjectGroup({
  activeThreadId,
  collapse,
  collapseKey,
  group,
  isCollapsible,
  nesting,
  onNavigate,
  projectName,
  threadsById,
}: {
  activeThreadId: string | null;
  collapse: ProjectionCollapseState;
  collapseKey: string;
  group: CanonicalSidebarProjectionProjectGroup;
  isCollapsible: boolean;
  nesting: CanonicalSidebarProjectionRegion["nesting"];
  onNavigate: () => void;
  projectName: string;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}) {
  const items = useRegionThreadItems({
    nesting,
    threadIds: group.threadIds,
    threadsById,
  });
  const onToggleKey = collapse.onToggleKey;
  const toggleCollapsed = useCallback(
    () => onToggleKey(collapseKey),
    [collapseKey, onToggleKey],
  );
  return (
    <TopLevelSidebarSection
      label={projectName}
      {...(isCollapsible
        ? {
            collapseControl: {
              isCollapsed: collapse.collapsedKeys.has(collapseKey),
              onToggleCollapsed: toggleCollapsed,
            },
          }
        : {})}
    >
      <ProjectionRows
        activeThreadId={activeThreadId}
        collapsedEnvironmentIds={collapse.collapsedEnvironmentIds}
        collapsedThreadIds={collapse.collapsedThreadIds}
        items={items}
        onNavigate={onNavigate}
        onToggleEnvironmentCollapsed={collapse.onToggleEnvironmentCollapsed}
        onToggleThreadCollapsed={collapse.onToggleThreadCollapsed}
        projectId={group.projectId}
      />
    </TopLevelSidebarSection>
  );
}

function ProjectionGroupedRegionBody({
  activeThreadId,
  collapse,
  onNavigate,
  projectNamesById,
  region,
  threadsById,
}: Omit<ProjectionRegionProps, "showDivider">) {
  const isCollapsible =
    region.grouping.kind === "project" && region.grouping.collapsible;
  const itemKeys = useMemo(
    () => region.projectGroups.map((group) => group.projectId),
    [region.projectGroups],
  );
  const estimateRows = useCallback(
    (index: number) => 1 + (region.projectGroups[index]?.threadIds.length ?? 0),
    [region.projectGroups],
  );
  const getNavigationEntries = useCallback(
    (index: number) =>
      (region.projectGroups[index]?.threadIds ?? []).flatMap((threadId) => {
        const thread = threadsById.get(threadId);
        return thread ? [{ threadId, projectId: thread.projectId }] : [];
      }),
    [region.projectGroups, threadsById],
  );
  const alwaysMountedKeys = useMemo(() => {
    if (activeThreadId === null) return undefined;
    const activeGroup = region.projectGroups.find((group) =>
      group.threadIds.includes(activeThreadId),
    );
    return activeGroup ? new Set([activeGroup.projectId]) : undefined;
  }, [activeThreadId, region.projectGroups]);
  const renderItem = useCallback(
    (index: number): ReactNode => {
      const group = region.projectGroups[index];
      if (group === undefined) return null;
      return (
        <ProjectionProjectGroup
          key={group.projectId}
          activeThreadId={activeThreadId}
          collapse={collapse}
          collapseKey={buildProjectionCollapseKey(region.id, group.projectId)}
          group={group}
          isCollapsible={isCollapsible}
          nesting={region.nesting}
          onNavigate={onNavigate}
          projectName={projectNamesById.get(group.projectId) ?? group.projectId}
          threadsById={threadsById}
        />
      );
    },
    [
      activeThreadId,
      collapse,
      isCollapsible,
      onNavigate,
      projectNamesById,
      region.id,
      region.nesting,
      region.projectGroups,
      threadsById,
    ],
  );

  if (region.projectGroups.length === 0) {
    return <ProjectionEmptyState />;
  }

  return (
    <SidebarWindowedItems
      itemKeys={itemKeys}
      estimateRows={estimateRows}
      getNavigationEntries={getNavigationEntries}
      {...(alwaysMountedKeys ? { alwaysMountedKeys } : {})}
      renderItem={renderItem}
    />
  );
}

function ProjectionRegionBody(
  props: Omit<ProjectionRegionProps, "showDivider">,
) {
  return props.region.grouping.kind === "project" ? (
    <ProjectionGroupedRegionBody {...props} />
  ) : (
    <ProjectionUngroupedRegionBody {...props} />
  );
}

/** Region and project-group collapse keys share one namespace, so build both here. */
function buildProjectionCollapseKey(
  regionId: string,
  projectId: string | null,
): string {
  return JSON.stringify([regionId, projectId]);
}

function ProjectionRegion(props: ProjectionRegionProps) {
  const { collapse, region, showDivider, threadsById } = props;
  const [displayOptionsOpen, setDisplayOptionsOpen] = useState(false);
  const regionThreads = useMemo(
    () =>
      region.threadOrder.flatMap((threadId) => {
        const thread = threadsById.get(threadId);
        return thread ? [thread] : [];
      }),
    [region.threadOrder, threadsById],
  );
  const draftThreadIds = usePromptDraftInputThreadIds(regionThreads);
  const collapsedActivity = useMemo(
    () => getCollapsedChildActivity(regionThreads, draftThreadIds),
    [draftThreadIds, regionThreads],
  );
  const collapseKey = buildProjectionCollapseKey(region.id, null);
  const onToggleKey = collapse.onToggleKey;
  const toggleCollapsed = useCallback(
    () => onToggleKey(collapseKey),
    [collapseKey, onToggleKey],
  );
  const body = <ProjectionRegionBody {...props} />;

  return (
    <div data-sidebar-projection-region={region.id}>
      {region.label === null ? (
        body
      ) : (
        <TopLevelSidebarSection
          label={region.label}
          actions={
            <SidebarDisplayOptionsMenu
              open={displayOptionsOpen}
              onOpenChange={setDisplayOptionsOpen}
            />
          }
          actionsMobileAlways
          actionsOpen={displayOptionsOpen}
          collapsedActivity={collapsedActivity}
          collapsedThreads={regionThreads}
          {...(region.collapsible
            ? {
                collapseControl: {
                  isCollapsed: collapse.collapsedKeys.has(collapseKey),
                  onToggleCollapsed: toggleCollapsed,
                },
              }
            : {})}
        >
          {body}
        </TopLevelSidebarSection>
      )}
      {showDivider ? (
        <div role="separator" className="my-2 h-px bg-sidebar-border" />
      ) : null}
    </div>
  );
}

/**
 * BB's display-options menu normally lives in a section header. A projection
 * whose regions are all header-less would otherwise lose it, taking the
 * thread-numbers toggle with it.
 */
function ProjectionHeaderlessDisplayOptions() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-end px-2 pb-1 group-data-[collapsible=icon]:hidden">
      <SidebarDisplayOptionsMenu open={open} onOpenChange={setOpen} />
    </div>
  );
}

function useProjectionCollapseState(): ProjectionCollapseState {
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [collapsedEnvironmentIdList, setCollapsedEnvironmentIdList] = useAtom(
    collapsedEnvironmentIdsAtom,
  );
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const collapsedThreadIds = useMemo(
    () => new Set(collapsedThreadIdList),
    [collapsedThreadIdList],
  );
  const collapsedEnvironmentIds = useMemo(
    () => new Set(collapsedEnvironmentIdList),
    [collapsedEnvironmentIdList],
  );
  const onToggleThreadCollapsed = useCallback(
    (threadId: string) =>
      setCollapsedThreadIdList((current) => toggleIdList(current, threadId)),
    [setCollapsedThreadIdList],
  );
  const onToggleEnvironmentCollapsed = useCallback(
    (environmentId: string) =>
      setCollapsedEnvironmentIdList((current) =>
        toggleIdList(current, environmentId),
      ),
    [setCollapsedEnvironmentIdList],
  );
  const onToggleKey = useCallback(
    (key: string) =>
      setCollapsedKeys((current) => {
        const next = new Set(current);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  return {
    collapsedEnvironmentIds,
    collapsedKeys,
    collapsedThreadIds,
    onToggleEnvironmentCollapsed,
    onToggleKey,
    onToggleThreadCollapsed,
  };
}

function toggleIdList(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((entry) => entry !== id)
    : [...current, id];
}

function hasRenderableContent(
  region: CanonicalSidebarProjectionRegion,
): boolean {
  return region.threadOrder.length > 0 || region.projectGroups.length > 0;
}

/**
 * The module-stable component a thread-list plugin receives as
 * `experimental_SidebarThreadProjection`.
 */
export function BoundSidebarThreadProjection({
  projection,
}: {
  projection: experimental_PluginSidebarThreadProjection;
}) {
  const binding = useContext(SidebarThreadProjectionBindingContext);
  if (binding === null) return null;
  return (
    <SidebarThreadProjectionHost binding={binding} projection={projection} />
  );
}

function SidebarThreadProjectionHost({
  binding,
  projection,
}: {
  binding: SidebarThreadProjectionBinding;
  projection: experimental_PluginSidebarThreadProjection;
}) {
  const { data } = useSidebarNavigation();
  const collapse = useProjectionCollapseState();
  const snapshot = useMemo(() => {
    if (!data) return null;
    return {
      projects: [
        ...data.projects.map(stripProjectThreads),
        stripProjectThreads(data.personalProject),
      ],
      threads: [
        ...data.projects.flatMap((project) => project.threads),
        ...data.personalProject.threads,
      ],
    };
  }, [data]);
  const validation = useMemo(
    () =>
      snapshot
        ? validateSidebarThreadProjection({
            projection,
            threads: snapshot.threads,
            projects: snapshot.projects,
          })
        : null,
    [projection, snapshot],
  );

  useEffect(() => {
    if (binding.isSearchFieldOpen || validation?.kind !== "invalid") return;
    const key = JSON.stringify([
      binding.pluginId,
      binding.generation,
      validation.reason,
    ]);
    if (!shouldReportProjectionFailure(key)) return;
    const description = `${binding.pluginId}: ${validation.diagnostic}`;
    console.warn(`Invalid sidebar thread projection — ${description}`);
    toast.error("Sidebar projection was invalid", { description });
  }, [
    binding.generation,
    binding.isSearchFieldOpen,
    binding.pluginId,
    validation,
  ]);

  const threads = snapshot?.threads ?? EMPTY_THREADS;
  const projects = snapshot?.projects ?? EMPTY_PROJECTS;
  const threadsById = useMemo(() => {
    const map = new Map<string, ThreadListEntry>();
    for (const thread of threads) {
      // The plugin never sees hidden threads and cannot place them, so the
      // renderer refuses to resolve one even if an id slips through.
      if (isSidebarProjectionEligibleThread(thread)) map.set(thread.id, thread);
    }
    return map;
  }, [threads]);
  const projectNamesById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const regions =
    validation?.kind === "valid"
      ? validation.projection.regions
      : EMPTY_REGIONS;
  const renderedRegions = useMemo(
    () => regions.filter(hasRenderableContent),
    [regions],
  );
  const stickyRegions = renderedRegions.filter(
    (region) => region.placement === "sticky",
  );
  const flowRegions = renderedRegions.filter(
    (region) => region.placement === "flow",
  );
  const lastRegionId = renderedRegions.at(-1)?.id;
  const renderRegion = (region: CanonicalSidebarProjectionRegion) => (
    <ProjectionRegion
      key={region.id}
      activeThreadId={binding.activeThreadId}
      collapse={collapse}
      onNavigate={binding.onNavigate}
      projectNamesById={projectNamesById}
      region={region}
      showDivider={region.dividerAfter && region.id !== lastRegionId}
      threadsById={threadsById}
    />
  );

  const Original = binding.Original;
  if (
    binding.isSearchFieldOpen ||
    snapshot === null ||
    validation?.kind !== "valid"
  ) {
    return <Original />;
  }

  if (renderedRegions.length === 0) {
    return (
      <ProjectListShell>
        <ProjectionEmptyState />
      </ProjectListShell>
    );
  }

  return (
    <>
      {renderedRegions.every((region) => region.label === null) ? (
        <ProjectionHeaderlessDisplayOptions />
      ) : null}
      {stickyRegions.length > 0 ? (
        <ProjectListShell>{stickyRegions.map(renderRegion)}</ProjectListShell>
      ) : null}
      {flowRegions.length > 0 ? (
        <SidebarGroupContent>
          {flowRegions.map(renderRegion)}
        </SidebarGroupContent>
      ) : null}
    </>
  );
}
