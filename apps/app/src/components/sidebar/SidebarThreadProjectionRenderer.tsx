import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import type {
  PluginSidebarThreadProjection,
  PluginSidebarThreadProjectionRegion,
} from "@get-bb/plugin-sdk";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { EmptyState } from "@bb/shared-ui/empty-state";
import { toast } from "sonner";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import {
  usePromptDraftHasInput,
  usePromptDraftInputThreadIds,
} from "@/hooks/usePromptDraftStorage";
import { getCollapsedChildActivity } from "@/lib/thread-activity";
import { useSetRootComposeProjectId } from "@/lib/root-compose-selection";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { SidebarWindowedItems } from "./SidebarWindowedItems";
import { ProjectListShell } from "./ProjectList";
import { ProjectRow, ProjectThreadTree } from "./ProjectRow";
import { ThreadRow } from "./ThreadRow";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection";
import type { ThreadComparator } from "./projectThreadGroups";
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

const reportedProjectionFailures = new Set<string>();

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
    left.id.localeCompare(right.id);
}

function ProjectionFlatThreadRow({
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
      options={{ kind: "default", depth: 0, isCompact: false }}
    />
  );
}

function ProjectionFlatThreadRows({
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
  return (
    <SidebarWindowedItems
      itemKeys={itemKeys}
      estimateRows={estimateRows}
      getNavigationEntries={getNavigationEntries}
      alwaysMountedKeys={alwaysMountedKeys}
      renderItem={(index) => {
        const thread = threads[index];
        return thread ? (
          <ProjectionFlatThreadRow
            key={thread.id}
            thread={thread}
            activeThreadId={activeThreadId}
            onNavigate={onNavigate}
          />
        ) : null;
      }}
    />
  );
}

interface ProjectionRegionProps {
  activeThreadId: string | null;
  binding: SidebarThreadProjectionBinding;
  collapsedKeys: ReadonlySet<string>;
  onCreateProjectThread: (projectId: string) => void;
  onToggleKey: (key: string) => void;
  projectsById: ReadonlyMap<string, ProjectResponse>;
  region: CanonicalSidebarProjectionRegion;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
}

function ProjectionProjectGroup({
  activeThreadId,
  binding,
  collapsedKeys,
  group,
  nesting,
  onCreateProjectThread,
  onToggleKey,
  project,
  region,
  threadsById,
}: Omit<ProjectionRegionProps, "projectsById"> & {
  group: CanonicalSidebarProjectionProjectGroup;
  nesting: PluginSidebarThreadProjectionRegion["nesting"];
  project: ProjectResponse;
}) {
  const projectCollapseKey = buildSidebarProjectionCollapseKey({
    pluginId: binding.pluginId,
    registrationId: binding.registrationId,
    regionId: region.id,
    projectId: project.id,
    itemId: "project",
  });
  const groupThreads = useMemo(
    () =>
      group.threadIds
        .map((threadId) => threadsById.get(threadId)!)
        .map((thread) =>
          nesting === "flat" ? { ...thread, parentThreadId: null } : thread,
        ),
    [group.threadIds, nesting, threadsById],
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
  }, [binding, collapsedKeys, groupThreads, region.id]);
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
  }, [binding, collapsedKeys, groupThreads, project.id, region.id]);
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
    [binding, onToggleKey, project.id, region.id],
  );

  return (
    <ProjectRow
      project={project}
      threadListState={{ status: "ready", threads: groupThreads }}
      selectedThreadId={activeThreadId ?? undefined}
      isActive={false}
      isCollapsed={
        region.grouping.kind === "project" && region.grouping.collapsible
          ? collapsedKeys.has(projectCollapseKey)
          : false
      }
      compareThreads={comparator}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      isLocalPathInvalid={false}
      headingTier={region.label === null ? "label" : "project"}
      groupEnvironmentThreads={nesting === "native"}
      onProjectSelect={binding.onNavigate}
      onCreateProjectThread={onCreateProjectThread}
      onToggleProjectCollapsed={() => onToggleKey(projectCollapseKey)}
      onToggleThreadCollapsed={toggleThread}
      onToggleEnvironmentCollapsed={toggleEnvironment}
    />
  );
}

function ProjectionRegionContent({
  activeThreadId,
  binding,
  collapsedKeys,
  onCreateProjectThread,
  onToggleKey,
  projectsById,
  region,
  threadsById,
}: ProjectionRegionProps) {
  if (region.grouping.kind === "project") {
    return (
      <div data-sidebar-sticky-project-item="" className="space-y-1">
        {region.projectGroups.map((group) => (
          <ProjectionProjectGroup
            key={group.projectId}
            activeThreadId={activeThreadId}
            binding={binding}
            collapsedKeys={collapsedKeys}
            group={group}
            nesting={region.nesting}
            onCreateProjectThread={onCreateProjectThread}
            onToggleKey={onToggleKey}
            project={projectsById.get(group.projectId)!}
            region={region}
            threadsById={threadsById}
          />
        ))}
      </div>
    );
  }

  const regionThreads = region.threadOrder.map(
    (threadId) => threadsById.get(threadId)!,
  );
  if (region.nesting === "flat") {
    return (
      <ProjectionFlatThreadRows
        threads={regionThreads}
        activeThreadId={activeThreadId}
        onNavigate={binding.onNavigate}
      />
    );
  }

  const comparator = createRankComparator(region.threadOrder);
  const collapsedThreadIds = new Set<string>();
  const collapsedEnvironmentIds = new Set<string>();
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
      collapsedThreadIds.add(thread.id);
    }
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
      collapsedEnvironmentIds.add(thread.environmentId);
    }
  }
  return (
    <ProjectThreadTree
      threadListState={{ status: "ready", threads: regionThreads }}
      compareThreads={comparator}
      variant="section"
      selectedThreadId={activeThreadId ?? undefined}
      collapsedThreadIds={collapsedThreadIds}
      collapsedEnvironmentIds={collapsedEnvironmentIds}
      onProjectSelect={binding.onNavigate}
      onToggleThreadCollapsed={(threadId) => {
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
      }}
      onToggleEnvironmentCollapsed={(environmentId) => {
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
      }}
    />
  );
}

function ProjectionRegion(props: ProjectionRegionProps) {
  const { binding, collapsedKeys, onToggleKey, region, threadsById } = props;
  const regionThreads = useMemo(
    () => region.threadOrder.map((threadId) => threadsById.get(threadId)!),
    [region.threadOrder, threadsById],
  );
  const draftThreadIds = usePromptDraftInputThreadIds(regionThreads);
  const collapsedActivity = useMemo(
    () => getCollapsedChildActivity(regionThreads, draftThreadIds),
    [draftThreadIds, regionThreads],
  );
  const regionCollapseKey = buildSidebarProjectionCollapseKey({
    pluginId: binding.pluginId,
    registrationId: binding.registrationId,
    regionId: region.id,
    itemId: "region",
  });
  const content = <ProjectionRegionContent {...props} />;
  return (
    <div data-sidebar-projection-region={region.id}>
      {region.label === null ? (
        content
      ) : (
        <TopLevelSidebarSection
          label={region.label}
          collapseControl={
            region.collapsible
              ? {
                  isCollapsed: collapsedKeys.has(regionCollapseKey),
                  onToggleCollapsed: () => onToggleKey(regionCollapseKey),
                }
              : undefined
          }
          collapsedActivity={collapsedActivity}
          collapsedThreads={regionThreads}
        >
          {content}
        </TopLevelSidebarSection>
      )}
      {region.dividerAfter ? (
        <div
          role="separator"
          aria-label={`${region.label ?? region.id} divider`}
          className="my-2 h-px bg-sidebar-border"
        />
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
  const binding = useContext(SidebarThreadProjectionBindingContext);
  if (binding === null) {
    throw new Error(
      "experimental_SidebarThreadProjection must render inside its bound thread-list registration.",
    );
  }
  return (
    <SidebarThreadProjectionHost binding={binding} projection={projection} />
  );
}

function SidebarThreadProjectionHost({
  binding,
  projection,
}: {
  binding: SidebarThreadProjectionBinding;
  projection: PluginSidebarThreadProjection;
}) {
  const navigationQuery = useSidebarNavigation();
  const navigate = useNavigate();
  const setRootComposeProjectId = useSetRootComposeProjectId();
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const onToggleKey = useCallback(
    (key: string) => setCollapsedKeys((current) => toggleKey(current, key)),
    [],
  );
  const onCreateProjectThread = useCallback(
    (projectId: string) => {
      setRootComposeProjectId(projectId);
      binding.onNavigate();
      void navigate(getRootComposeRoutePath(), {
        state: { focusPrompt: true },
      });
    },
    [binding, navigate, setRootComposeProjectId],
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
    if (reportedProjectionFailures.has(failureKey)) return;
    reportedProjectionFailures.add(failureKey);
    const description = `${binding.pluginId}: ${validation.diagnostic}`;
    console.warn(`Invalid sidebar thread projection — ${description}`);
    toast.error("Sidebar projection was invalid", { description });
  }, [
    binding.generation,
    binding.isSearchActive,
    binding.pluginId,
    validation,
  ]);

  const Original = binding.original;
  if (
    binding.isSearchActive ||
    hostSnapshot === null ||
    validation?.kind !== "valid"
  ) {
    return <Original />;
  }

  const canonical = validation.projection;
  const threadsById = new Map(
    hostSnapshot.threads.map((thread) => [thread.id, thread] as const),
  );
  const projectsById = new Map(
    hostSnapshot.projects.map((project) => [project.id, project] as const),
  );
  const stickyRegions = canonical.regions.filter(
    (region) => region.placement === "sticky",
  );
  const flowRegions = canonical.regions.filter(
    (region) => region.placement === "flow",
  );
  const renderRegion = (
    region: CanonicalSidebarProjectionRegion,
  ): ReactNode => (
    <ProjectionRegion
      key={region.id}
      activeThreadId={binding.activeThreadId}
      binding={binding}
      collapsedKeys={collapsedKeys}
      onCreateProjectThread={onCreateProjectThread}
      onToggleKey={onToggleKey}
      projectsById={projectsById}
      region={region}
      threadsById={threadsById}
    />
  );

  return (
    <ProjectListShell>
      {canonical.regions.every((region) => region.threadOrder.length === 0) ? (
        <EmptyState
          message="No threads"
          icon="MessageSquare"
          className="px-2 py-1.5"
          iconClassName="size-3.5 text-subtle-foreground/50"
          messageClassName="text-xs text-subtle-foreground/60"
        />
      ) : (
        <>
          {stickyRegions.length > 0 ? (
            <div
              data-sidebar-projection-sticky-regions=""
              className="sticky top-0 z-[70] bg-sidebar"
            >
              {stickyRegions.map(renderRegion)}
            </div>
          ) : null}
          {flowRegions.map(renderRegion)}
        </>
      )}
    </ProjectListShell>
  );
}
