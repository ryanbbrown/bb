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
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon } from "@bb/shared-ui/icon";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
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
import {
  SidebarGroupContent,
  SidebarStickyGroup,
  SidebarStickyTier,
} from "@/components/ui/sidebar.js";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  stripProjectThreads,
  type SidebarProject,
} from "@/hooks/queries/project-queries";
import { usePromptDraftInputThreadIds } from "@/hooks/usePromptDraftStorage";
import { ProjectListShell, SidebarDisplayOptionsMenu } from "./ProjectList";
import { ThreadTreeNodeRow } from "./ProjectRow";
import { SidebarWindowedItems } from "./SidebarWindowedItems";
import { SIDEBAR_STANDARD_ROW_PADDING_CLASS } from "./sidebarRowClasses";
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

function resolveRegionThreads(
  nesting: CanonicalSidebarProjectionRegion["nesting"],
  threadIds: readonly string[],
  threadsById: ReadonlyMap<string, ThreadListEntry>,
): ThreadListEntry[] {
  const result: ThreadListEntry[] = [];
  for (const threadId of threadIds) {
    const thread = threadsById.get(threadId);
    if (thread === undefined) continue;
    result.push(nesting === "flat" ? asRootThread(thread) : thread);
  }
  return result;
}

/**
 * The one place a region's thread ids become native tree items, so rendered
 * rows and windowing metadata can never disagree about order or nesting.
 *
 * Worktree environment grouping is deliberately absent: it emits group items
 * that no exported row component can render, which would drop their threads.
 */
function buildProjectionThreadItems({
  draftThreadIds,
  nesting,
  threadIds,
  threadsById,
}: {
  draftThreadIds: ReadonlySet<string>;
  nesting: CanonicalSidebarProjectionRegion["nesting"];
  threadIds: readonly string[];
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}): ProjectThreadItem[] {
  return buildChronologicalThreadList(
    resolveRegionThreads(nesting, threadIds, threadsById),
    createRankComparator(threadIds),
    draftThreadIds,
  );
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
  const threads = useMemo(
    () => resolveRegionThreads(nesting, threadIds, threadsById),
    [nesting, threadIds, threadsById],
  );
  const draftThreadIds = usePromptDraftInputThreadIds(threads);
  return useMemo(
    () =>
      buildProjectionThreadItems({
        draftThreadIds,
        nesting,
        threadIds,
        threadsById,
      }),
    [draftThreadIds, nesting, threadIds, threadsById],
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
  /** Set on exactly one region: BB's sidebar shows one of these menus. */
  showDisplayOptions: boolean;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}

type ProjectionRegionBodyProps = Omit<
  ProjectionRegionProps,
  "showDivider" | "showDisplayOptions"
>;

function ProjectionUngroupedRegionBody({
  activeThreadId,
  collapse,
  onNavigate,
  region,
  threadsById,
}: ProjectionRegionBodyProps) {
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

/**
 * A project heading inside a region. It cannot reuse `TopLevelSidebarSection`:
 * that emits `tier="label"`, and two label tiers in one sticky stack pin at
 * the same offset and z-index and overlap. Native's second level is
 * `tier="project"`, which pins one stride lower.
 */
function ProjectionProjectHeading({
  isCollapsed,
  isCollapsible,
  onToggleCollapsed,
  projectName,
}: {
  isCollapsed: boolean;
  isCollapsible: boolean;
  onToggleCollapsed: () => void;
  projectName: string;
}) {
  return (
    <SidebarStickyTier
      tier="project"
      className={cn(
        SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
        CHROME_SECTION_LABEL_CLASS,
        SIDEBAR_STANDARD_ROW_PADDING_CLASS,
        "rounded-md pr-0 transition-colors",
      )}
    >
      <span className="relative z-10 flex min-w-0 flex-1 items-center gap-1 text-left">
        <span className="min-w-0 truncate" title={projectName}>
          {projectName}
        </span>
        {isCollapsible ? (
          <button
            type="button"
            aria-expanded={!isCollapsed}
            aria-label={
              isCollapsed
                ? `Expand ${projectName} section`
                : `Collapse ${projectName} section`
            }
            data-sidebar-hover-actions-mobile={
              SIDEBAR_HOVER_ACTIONS_MOBILE_ALWAYS_VALUE
            }
            className={cn(
              !isCollapsed && SIDEBAR_HOVER_ACTIONS_CLASS,
              "relative z-20 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-subtle-foreground outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2",
              LIST_HOVER_TRANSITION,
            )}
            onClick={onToggleCollapsed}
          >
            <Icon
              name="ChevronRight"
              className={cn(
                "size-3 transition-transform duration-150",
                !isCollapsed && "rotate-90",
              )}
              aria-hidden="true"
            />
          </button>
        ) : null}
      </span>
    </SidebarStickyTier>
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
  const isCollapsed = isCollapsible && collapse.collapsedKeys.has(collapseKey);
  return (
    <SidebarStickyGroup className="min-w-0">
      <ProjectionProjectHeading
        isCollapsed={isCollapsed}
        isCollapsible={isCollapsible}
        onToggleCollapsed={toggleCollapsed}
        projectName={projectName}
      />
      {isCollapsed ? null : (
        <div className="mt-1">
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
        </div>
      )}
    </SidebarStickyGroup>
  );
}

function ProjectionGroupedRegionBody({
  activeThreadId,
  collapse,
  onNavigate,
  projectNamesById,
  region,
  threadsById,
}: ProjectionRegionBodyProps) {
  const isCollapsible =
    region.grouping.kind === "project" && region.grouping.collapsible;
  // A windowed-out group is replaced by a placeholder carrying its row count
  // and its threads in visual order, so both have to come from the same item
  // tree and collapse state the group renders — not from the flat id list.
  const groupMetadata = useMemo(
    () =>
      region.projectGroups.map((group) => {
        const isCollapsed =
          isCollapsible &&
          collapse.collapsedKeys.has(
            buildProjectionCollapseKey(region.id, group.projectId),
          );
        if (isCollapsed) {
          return { group, navigationEntries: [], rows: 1 };
        }
        const items = buildProjectionThreadItems({
          nesting: region.nesting,
          threadIds: group.threadIds,
          threadsById,
          // Drafts only decorate a row; they change neither order nor row count.
          draftThreadIds: EMPTY_ID_SET,
        });
        const rowCountContext: ProjectThreadItemRowCountContext = {
          collapsedThreadIds: collapse.collapsedThreadIds,
          collapsedEnvironmentIds: collapse.collapsedEnvironmentIds,
          collapsedSectionKeys: EMPTY_ID_SET,
        };
        return {
          group,
          navigationEntries: items.flatMap((item) =>
            collectProjectThreadItemNavigationEntries(item, rowCountContext),
          ),
          // The project heading is a row of its own.
          rows:
            1 +
            items.reduce(
              (total, item) =>
                total + countProjectThreadItemRows(item, rowCountContext),
              0,
            ),
        };
      }),
    [
      collapse.collapsedEnvironmentIds,
      collapse.collapsedKeys,
      collapse.collapsedThreadIds,
      isCollapsible,
      region.id,
      region.nesting,
      region.projectGroups,
      threadsById,
    ],
  );
  const itemKeys = useMemo(
    () => groupMetadata.map(({ group }) => group.projectId),
    [groupMetadata],
  );
  const estimateRows = useCallback(
    (index: number) => groupMetadata[index]?.rows ?? 1,
    [groupMetadata],
  );
  const getNavigationEntries = useCallback(
    (index: number) => groupMetadata[index]?.navigationEntries ?? [],
    [groupMetadata],
  );
  const alwaysMountedKeys = useMemo(() => {
    if (activeThreadId === null) return undefined;
    const activeGroup = groupMetadata.find(({ navigationEntries }) =>
      navigationEntries.some((entry) => entry.threadId === activeThreadId),
    );
    return activeGroup ? new Set([activeGroup.group.projectId]) : undefined;
  }, [activeThreadId, groupMetadata]);
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

function ProjectionRegionBody(props: ProjectionRegionBodyProps) {
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
  const { collapse, region, showDisplayOptions, showDivider, threadsById } =
    props;
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
          {...(showDisplayOptions
            ? {
                actions: (
                  <SidebarDisplayOptionsMenu
                    open={displayOptionsOpen}
                    onOpenChange={setDisplayOptionsOpen}
                  />
                ),
              }
            : {})}
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
 * BB's display-options menu normally lives in a section heading. A projection
 * with no heading to host it — every region header-less, or no region rendered
 * at all — gets this standalone control instead, so the thread-numbers toggle
 * never disappears.
 */
function ProjectionStandaloneDisplayOptions() {
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
    // One plugin can register several thread lists, and each reload bumps the
    // generation; those are different failures and each deserves one report.
    const key = JSON.stringify([
      binding.pluginId,
      binding.registrationId,
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
    binding.registrationId,
    validation,
  ]);

  const threads = snapshot?.threads ?? EMPTY_THREADS;
  const projects = snapshot?.projects ?? EMPTY_PROJECTS;
  const threadsById = useMemo(() => {
    const map = new Map<string, ThreadListEntry>();
    for (const thread of threads) {
      // Validation already drops ineligible ids; this keeps the row-resolving
      // map incapable of producing one even if that ever regresses.
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
  // BB's sidebar carries one display-options menu. Hosting it in the first
  // heading keeps it pinned like native; with no heading to host it, a
  // standalone control takes over so the thread-numbers toggle never vanishes.
  const displayOptionsRegionId = renderedRegions.find(
    (region) => region.label !== null,
  )?.id;
  const renderRegion = (region: CanonicalSidebarProjectionRegion) => (
    <ProjectionRegion
      key={region.id}
      activeThreadId={binding.activeThreadId}
      collapse={collapse}
      onNavigate={binding.onNavigate}
      projectNamesById={projectNamesById}
      region={region}
      showDisplayOptions={region.id === displayOptionsRegionId}
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
        <ProjectionStandaloneDisplayOptions />
        <ProjectionEmptyState />
      </ProjectListShell>
    );
  }

  return (
    <>
      {displayOptionsRegionId === undefined ? (
        <ProjectionStandaloneDisplayOptions />
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
