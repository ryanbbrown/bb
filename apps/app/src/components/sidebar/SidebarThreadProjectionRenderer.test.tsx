// @vitest-environment jsdom
import { useMemo } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import type { PluginSidebarThreadProjection } from "@get-bb/plugin-sdk";

const testState = vi.hoisted(() => ({
  navigation: null as unknown,
  scrollElementRef: { current: null as HTMLDivElement | null },
  invalidProjectIds: new Set<string>(),
  draftThreadIds: new Set<string>(),
  regionDraftCalls: 0,
  rowDraftCalls: 0,
  splitEnabled: false,
  splitOpenThreadIds: new Set<string>(),
  pluginStatusThreadIds: new Set<string>(),
}));
const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  warn: vi.fn(),
  archive: vi.fn(),
  requestDelete: vi.fn(),
  rename: vi.fn(),
  openInSplit: vi.fn(),
  splitPointerDown: vi.fn(),
  setRootComposeProjectId: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.spyOn(console, "warn").mockImplementation(mocks.warn);
vi.mock("@/components/ui/sidebar.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/ui/sidebar.js")>();
  return {
    ...actual,
    useSidebarContentElementRef: () => testState.scrollElementRef,
  };
});
vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => testState.splitEnabled,
}));
vi.mock("./paneContentSplitIndicator", () => ({
  usePaneContentSplitIndicator: (content: { threadId?: string }) => ({
    isOpenInSplit:
      content.threadId !== undefined &&
      testState.splitOpenThreadIds.has(content.threadId),
    miniMap: null,
  }),
  useThreadGroupSplitIndicator: () => ({
    isOpenInSplit: false,
    miniMap: null,
  }),
}));
vi.mock("./useThreadRowSplitDrag", () => ({
  useThreadRowSplitDrag: ({ threadId }: { threadId: string }) => ({
    onPointerDown: testState.splitEnabled
      ? (event: PointerEvent) => mocks.splitPointerDown(threadId, event)
      : undefined,
    openInSplit: () => mocks.openInSplit(threadId),
  }),
}));
vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: ({ threadId }: { threadId: string }) => {
    testState.rowDraftCalls += 1;
    return testState.draftThreadIds.has(threadId);
  },
  usePromptDraftInputThreadIds: (threads: readonly ThreadListEntry[]) => {
    testState.regionDraftCalls += 1;
    return new Set(
      threads
        .filter(({ id }) => testState.draftThreadIds.has(id))
        .map(({ id }) => id),
    );
  },
}));
vi.mock("@/lib/plugin-thread-row-status", () => ({
  usePluginThreadRowStatus: (threadId: string) =>
    testState.pluginStatusThreadIds.has(threadId)
      ? {
          icon: "AiContentGenerator01",
          label: "Plugin task running",
          tone: "running",
        }
      : null,
}));
vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));
vi.mock("@/hooks/useCreateThreadInWorktree", () => ({
  useCreateThreadInWorktree: () => vi.fn(),
}));
vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutate: vi.fn(),
    variables: undefined,
  }),
  useUpdateEnvironment: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    variables: undefined,
  }),
}));
vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: mocks.rename,
    requestRename: vi.fn(),
    requestDelete: mocks.requestDelete,
    archiveThreadAndChildren: mocks.archive,
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));
vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: testState.navigation }),
}));
vi.mock("./useSidebarProjectPathInvalidity", () => ({
  useSidebarProjectPathInvalidity: () => testState.invalidProjectIds,
}));
vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => mocks.setRootComposeProjectId,
}));

const { getSidebarThreadNavigationTargets } =
  await import("./sidebarThreadShortcuts");
const { SIDEBAR_WINDOWED_MAX_WRAPPERS } =
  await import("./SidebarWindowedItems");
const {
  BoundSidebarThreadProjection,
  SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES,
  SidebarThreadProjectionBindingContext,
  getSidebarProjectionDiagnosticCountForTest,
  resetSidebarProjectionDiagnosticsForTest,
} = await import("./SidebarThreadProjectionRenderer");

function makeProject(
  id: string,
  name: string,
  threads: ThreadListEntry[] = [],
): ProjectResponse & { threads: ThreadListEntry[] } {
  return {
    id,
    name,
    kind: "standard",
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
    threads,
  };
}

function makeThread(
  id: string,
  projectId: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  return {
    id,
    projectId,
    environmentId: null,
    providerId: "codex",
    title: id,
    titleFallback: null,
    sectionId: null,
    status: "idle",
    parentThreadId: null,
    sourceThreadId: null,
    originKind: null,
    originPluginId: null,
    visibility: "visible",
    archivedAt: null,
    pinnedAt: null,
    pinSortKey: null,
    deletedAt: null,
    lastReadAt: 100,
    latestAttentionAt: 100,
    createdAt: 0,
    updatedAt: 100,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    ...overrides,
  };
}

function setNavigation(
  projects: Array<ProjectResponse & { threads: ThreadListEntry[] }>,
) {
  testState.navigation = {
    projects,
    personalProject: {
      ...makeProject("personal", "Personal"),
      kind: "personal",
    },
  };
}

function projectGrouping(
  projectOrder: readonly string[],
  options: { collapsible?: boolean; showEmptyProjects?: boolean } = {},
) {
  return {
    kind: "project" as const,
    projectOrder,
    collapsible: options.collapsible ?? false,
    showEmptyProjects: options.showEmptyProjects ?? false,
  };
}

function region(
  id: string,
  threadOrder: readonly string[],
  overrides: Partial<PluginSidebarThreadProjection["regions"][number]> = {},
): PluginSidebarThreadProjection["regions"][number] {
  return {
    id,
    label: id,
    placement: "flow",
    dividerAfter: false,
    collapsible: false,
    nesting: "flat",
    grouping: { kind: "none" },
    threadOrder,
    ...overrides,
  };
}

function Original() {
  return <p>Original sidebar</p>;
}

function ProjectionTree({
  activeThreadId = null,
  generation = 1,
  isSearchActive = false,
  pluginId = "test-plugin",
  projection,
}: {
  activeThreadId?: string | null;
  generation?: number;
  isSearchActive?: boolean;
  pluginId?: string;
  projection: PluginSidebarThreadProjection;
}) {
  const binding = useMemo(
    () => ({
      activeThreadId,
      generation,
      isSearchActive,
      onNavigate: () => undefined,
      original: Original,
      pluginId,
      registrationId: "test-list",
    }),
    [activeThreadId, generation, isSearchActive, pluginId],
  );
  return (
    <TooltipProvider>
      <MemoryRouter>
        <SidebarThreadProjectionBindingContext.Provider value={binding}>
          <BoundSidebarThreadProjection projection={projection} />
        </SidebarThreadProjectionBindingContext.Provider>
      </MemoryRouter>
    </TooltipProvider>
  );
}

function renderProjection(
  projection: PluginSidebarThreadProjection,
  options: Omit<Parameters<typeof ProjectionTree>[0], "projection"> = {},
) {
  return render(<ProjectionTree projection={projection} {...options} />);
}

function enableOffscreenWindowing(): void {
  const scrollElement = document.createElement("div");
  Object.defineProperty(scrollElement, "clientHeight", { value: 500 });
  testState.scrollElementRef.current = scrollElement;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      if (this === scrollElement) return new DOMRect(0, 0, 300, 500);
      if (this.hasAttribute("data-sidebar-windowed-item")) {
        return new DOMRect(0, 2_000, 300, 30);
      }
      return new DOMRect();
    },
  );
}

beforeEach(() => {
  const a = makeThread("thread-a", "project-a", { title: "Manager" });
  const b = makeThread("thread-b", "project-a", { title: "Independent" });
  setNavigation([makeProject("project-a", "Project A", [a, b])]);
  testState.scrollElementRef.current = null;
  testState.invalidProjectIds = new Set();
  testState.draftThreadIds = new Set();
  testState.regionDraftCalls = 0;
  testState.rowDraftCalls = 0;
  testState.splitEnabled = false;
  testState.splitOpenThreadIds = new Set();
  testState.pluginStatusThreadIds = new Set();
  resetSidebarProjectionDiagnosticsForTest();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("BoundSidebarThreadProjection", () => {
  it.each(["", "find me"])(
    "bypasses invalid projection diagnostics during active search %j",
    () => {
      renderProjection(
        { regions: [], excludedThreadIds: [] },
        {
          isSearchActive: true,
        },
      );
      expect(screen.getByText("Original sidebar")).toBeDefined();
      expect(mocks.toastError).not.toHaveBeenCalled();
    },
  );

  it("falls back atomically, deduplicates diagnostics, and retries later values", () => {
    const invalid = { regions: [], excludedThreadIds: [] };
    const rendered = renderProjection(invalid);
    expect(screen.getByText("Original sidebar")).toBeDefined();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    rendered.rerender(<ProjectionTree projection={invalid} />);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    rendered.rerender(
      <ProjectionTree
        projection={{
          regions: [],
          excludedThreadIds: ["thread-a", "thread-b"],
        }}
      />,
    );
    expect(screen.queryByText("Original sidebar")).toBeNull();
    expect(screen.getByText("No threads")).toBeDefined();
  });

  it("bounds per-tab diagnostic deduplication storage", () => {
    for (
      let generation = 0;
      generation < SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES + 5;
      generation += 1
    ) {
      const rendered = renderProjection(
        { regions: [], excludedThreadIds: [] },
        { generation },
      );
      rendered.unmount();
    }
    expect(getSidebarProjectionDiagnosticCountForTest()).toBe(
      SIDEBAR_PROJECTION_MAX_REPORTED_FAILURES,
    );
  });

  it("does not create region-wide draft subscriptions without collapse UI", () => {
    renderProjection({
      regions: [
        region("manager", ["thread-a"], { label: null }),
        region("independent", ["thread-b"]),
      ],
      excludedThreadIds: [],
    });
    // Native rows still read their own per-thread draft hook. The array-wide
    // hook is reserved for a region header that can collapse.
    expect(testState.regionDraftCalls).toBe(0);
  });

  it("omits non-collapsible project controls and isolates repeated collapse state", () => {
    const projection: PluginSidebarThreadProjection = {
      regions: [
        region("first", ["thread-a"], {
          grouping: projectGrouping(["project-a"], { collapsible: true }),
        }),
        region("second", ["thread-b"], {
          grouping: projectGrouping(["project-a"], { collapsible: true }),
        }),
      ],
      excludedThreadIds: [],
    };
    renderProjection(projection);
    const controls = screen.getAllByRole("button", {
      name: "Collapse Project A section",
    });
    expect(controls).toHaveLength(2);
    fireEvent.click(controls[0]!);
    expect(screen.queryByRole("link", { name: "Open Manager" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Open Independent" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Expand Project A section" }),
    );
    expect(screen.getByRole("link", { name: "Open Manager" })).toBeDefined();

    cleanup();
    renderProjection({
      ...projection,
      regions: projection.regions.map((item) => ({
        ...item,
        grouping:
          item.grouping.kind === "project"
            ? { ...item.grouping, collapsible: false }
            : item.grouping,
      })),
    });
    expect(
      screen.queryByRole("button", { name: /Project A section/u }),
    ).toBeNull();
  });

  it("keeps requested empty projects and prunes empty regions and stray dividers", () => {
    setNavigation([makeProject("project-a", "Project A")]);
    renderProjection({
      regions: [
        region("omitted", [], { dividerAfter: true }),
        region("empty projects", [], {
          dividerAfter: true,
          grouping: projectGrouping(["project-a"], {
            showEmptyProjects: true,
          }),
        }),
        region("also omitted", []),
      ],
      excludedThreadIds: [],
    });
    expect(screen.getByTitle("Project A")).toBeDefined();
    const newThread = screen.getByRole("button", {
      name: "New thread in Project A",
    });
    expect(newThread).toBeDefined();
    fireEvent.click(newThread);
    expect(mocks.setRootComposeProjectId).toHaveBeenCalledWith("project-a");
    expect(
      document.querySelector('[data-sidebar-projection-region="omitted"]'),
    ).toBeNull();
    expect(screen.queryByRole("separator")).toBeNull();
    expect(screen.queryByText("No threads")).not.toBeNull();

    cleanup();
    renderProjection({ regions: [], excludedThreadIds: [] });
    expect(screen.getAllByText("No threads")).toHaveLength(1);
  });

  it("renders native region hierarchy and dividers around Firstmate-style sections", () => {
    const manager = makeThread("manager", "project-a", { title: "Manager" });
    const managed = makeThread("managed", "project-a", {
      title: "Managed session",
    });
    const independent = makeThread("independent", "project-a", {
      title: "Independent thread",
    });
    setNavigation([
      makeProject("project-a", "Project A", [manager, managed, independent]),
    ]);
    renderProjection({
      regions: [
        region("manager", ["manager"], {
          label: null,
          placement: "sticky",
          dividerAfter: true,
        }),
        region("managed-sessions", ["managed"], {
          label: "Managed sessions",
          dividerAfter: true,
          grouping: projectGrouping(["project-a"]),
        }),
        region("independent-threads", ["independent"], {
          label: "Independent threads",
          grouping: projectGrouping(["project-a"]),
        }),
      ],
      excludedThreadIds: [],
    });

    const managedHeading = screen.getByRole("heading", {
      level: 2,
      name: "Managed sessions",
    });
    const independentHeading = screen.getByRole("heading", {
      level: 2,
      name: "Independent threads",
    });
    const projectHeadings = screen.getAllByRole("heading", {
      level: 3,
      name: "Project A",
    });
    const managedTier = managedHeading.closest("[data-sidebar-sticky-tier]");
    const independentTier = independentHeading.closest(
      "[data-sidebar-sticky-tier]",
    );
    for (const className of [
      "text-2xs",
      "font-semibold",
      "uppercase",
      "tracking-wide",
    ]) {
      expect(managedTier?.classList.contains(className)).toBe(true);
      expect(independentTier?.classList.contains(className)).toBe(true);
    }
    expect(projectHeadings).toHaveLength(2);
    expect(
      projectHeadings[0]?.closest("[data-sidebar-sticky-tier]")?.className,
    ).toContain("text-xs");
    expect(
      projectHeadings[0]?.closest("[data-sidebar-sticky-tier]")?.className,
    ).not.toContain("uppercase");

    const managerRegion = document.querySelector(
      '[data-sidebar-projection-region="manager"]',
    );
    const managedRegion = document.querySelector(
      '[data-sidebar-projection-region="managed-sessions"]',
    );
    const independentRegion = document.querySelector(
      '[data-sidebar-projection-region="independent-threads"]',
    );
    expect(
      managerRegion?.querySelectorAll(":scope > [role=separator]"),
    ).toHaveLength(1);
    expect(
      managedRegion?.querySelectorAll(":scope > [role=separator]"),
    ).toHaveLength(1);
    expect(
      independentRegion?.querySelectorAll(":scope > [role=separator]"),
    ).toHaveLength(0);
    expect(screen.getAllByRole("separator")).toHaveLength(2);
  });

  it("uses native sticky ownership and reserves multiple-region height for flow tiers", () => {
    const third = makeThread("thread-c", "project-a", { title: "Flow" });
    const current = testState.navigation as {
      projects: Array<ProjectResponse & { threads: ThreadListEntry[] }>;
    };
    setNavigation([
      makeProject("project-a", "Project A", [
        ...current.projects[0]!.threads,
        third,
      ]),
    ]);
    const stickyHeight = 72;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return new DOMRect(
          0,
          0,
          300,
          this.hasAttribute("data-sidebar-projection-sticky-regions")
            ? stickyHeight
            : 30,
        );
      },
    );
    renderProjection({
      regions: [
        region("manager", ["thread-a"], {
          label: "Manager",
          placement: "sticky",
        }),
        region("second sticky", ["thread-b"], {
          label: "Grouped sticky",
          placement: "sticky",
          grouping: projectGrouping(["project-a"]),
        }),
        region("flow", ["thread-c"]),
      ],
      excludedThreadIds: [],
    });
    const sticky = document.querySelector(
      "[data-sidebar-projection-sticky-regions]",
    );
    const stack = document.querySelector<HTMLElement>(
      "[data-sidebar-sticky-stack]",
    );
    expect(sticky).not.toBeNull();
    expect(
      sticky?.querySelectorAll("[data-sidebar-projection-region]"),
    ).toHaveLength(2);
    expect(sticky?.className).not.toContain("z-[70]");
    expect(
      (sticky as HTMLElement | null)?.style.getPropertyValue(
        "--bb-sidebar-sticky-projection-offset",
      ),
    ).toBe("");
    expect(
      stack?.style.getPropertyValue("--bb-sidebar-sticky-projection-offset"),
    ).toBe(`${stickyHeight}px`);
    expect(
      sticky?.querySelector('[data-sidebar-sticky-tier="label"]'),
    ).not.toBeNull();
    expect(
      sticky?.querySelector('[data-sidebar-sticky-tier="project"]'),
    ).not.toBeNull();
    expect(
      sticky?.querySelector('[data-sidebar-projection-region="flow"]'),
    ).toBeNull();
  });

  it("renders native nesting, cross-project identity, and source indentation", () => {
    const parent = makeThread("parent", "project-a", { title: "Parent" });
    const child = makeThread("child", "project-b", {
      title: "Child",
      parentThreadId: "parent",
    });
    setNavigation([
      makeProject("project-a", "Project A", [parent]),
      makeProject("project-b", "Project B", [child]),
    ]);
    renderProjection({
      regions: [
        region("nested", ["parent", "child"], {
          nesting: "native",
          grouping: projectGrouping(["project-a"]),
        }),
      ],
      excludedThreadIds: [],
    });
    const parentLink = screen.getByRole("link", { name: "Open Parent" });
    const childLink = screen.getByRole("link", { name: "Open Child" });
    expect(childLink.parentElement?.style.paddingLeft).not.toBe(
      parentLink.parentElement?.style.paddingLeft,
    );
    expect(
      screen.getByRole("img", { name: "In another project" }),
    ).toBeDefined();
  });

  it("keeps flat project order and passes flattened copies to native actions", () => {
    const parent = makeThread("parent", "project-a", { title: "Parent" });
    const child = makeThread("child", "project-a", {
      title: "Child",
      parentThreadId: "parent",
    });
    setNavigation([makeProject("project-a", "Project A", [parent, child])]);
    const rendered = renderProjection({
      regions: [
        region("flat projects", ["child", "parent"], {
          grouping: projectGrouping(["project-a"]),
        }),
      ],
      excludedThreadIds: [],
    });

    expect(
      [...rendered.container.querySelectorAll("[data-sidebar-thread-id]")].map(
        (element) => element.getAttribute("data-sidebar-thread-id"),
      ),
    ).toEqual(["child", "parent"]);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Archive thread" })[0]!,
    );
    expect(mocks.archive).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "child",
        parentThreadId: null,
        projectId: "project-a",
        title: "Child",
      }),
    );
  });

  it("passes native active, split, draft, status, action, and keyboard state", () => {
    const a = makeThread("thread-a", "project-a", {
      title: "Manager",
      status: "error",
      lastReadAt: 0,
      latestAttentionAt: 100,
    });
    const b = makeThread("thread-b", "project-a", { title: "Independent" });
    setNavigation([makeProject("project-a", "Project A", [a, b])]);
    testState.draftThreadIds.add("thread-a");
    testState.pluginStatusThreadIds.add("thread-b");
    testState.splitEnabled = true;
    testState.splitOpenThreadIds.add("thread-b");
    renderProjection(
      {
        regions: [region("rows", ["thread-a", "thread-b"], { label: null })],
        excludedThreadIds: [],
      },
      { activeThreadId: "thread-a" },
    );
    const active = screen.getByRole("link", {
      name: "Open Manager (unsubmitted draft)",
    });
    const split = screen.getByRole("link", { name: "Open Independent" });
    expect(active.parentElement?.className).toContain(
      "bb-sidebar-selected-row",
    );
    expect(split.parentElement?.className).toContain(
      "bb-sidebar-open-in-split-row",
    );
    expect(active.dataset.sidebarThreadShortcutTarget).toBe("");
    expect(active.dataset.sidebarThreadId).toBe("thread-a");
    expect(screen.getByLabelText("Unread thread failed")).toBeDefined();
    expect(screen.getByLabelText("Plugin task running")).toBeDefined();
    fireEvent.click(split, { metaKey: true });
    expect(mocks.openInSplit).toHaveBeenCalledWith("thread-b");
    fireEvent.pointerDown(split);
    expect(mocks.splitPointerDown).toHaveBeenCalled();
    expect(active.parentElement?.className).toContain(
      "max-md:pointer-coarse:h-[var(--bb-sidebar-row-height-coarse)]",
    );
    expect(
      screen.getAllByRole("button", { name: "Thread actions" }),
    ).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole("button", { name: "Archive thread" })[0]!,
    );
    expect(mocks.archive).toHaveBeenCalledWith(a);

    fireEvent.doubleClick(screen.getByTitle("Manager"));
    const editor = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(editor, { target: { value: "Renamed manager" } });
    fireEvent.keyDown(editor, { key: "Enter" });
    expect(mocks.rename).toHaveBeenCalledWith("thread-a", "Renamed manager");

    vi.useFakeTimers();
    const actions = screen.getAllByRole("button", {
      name: "Thread actions",
    })[0]!;
    fireEvent.pointerDown(actions, { button: 0, ctrlKey: false });
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    vi.runAllTimers();
    expect(mocks.requestDelete).toHaveBeenCalledWith(a);
    vi.useRealTimers();
  });

  it("renders the native missing-project-path warning only for invalid paths", () => {
    testState.invalidProjectIds = new Set(["project-a"]);
    const projection = {
      regions: [
        region("projects", ["thread-a", "thread-b"], {
          grouping: projectGrouping(["project-a"]),
        }),
      ],
      excludedThreadIds: [],
    } satisfies PluginSidebarThreadProjection;
    const rendered = renderProjection(projection);
    expect(screen.getByLabelText("Project folder not found")).toBeDefined();
    testState.invalidProjectIds = new Set();
    rendered.rerender(<ProjectionTree projection={projection} />);
    expect(screen.queryByLabelText("Project folder not found")).toBeNull();
  });

  it("keeps stable project rows from rebuilding draft subscriptions", () => {
    const projection = {
      regions: [
        region("projects", ["thread-a", "thread-b"], {
          grouping: projectGrouping(["project-a"]),
        }),
      ],
      excludedThreadIds: [],
    } satisfies PluginSidebarThreadProjection;
    const rendered = renderProjection(projection);
    const rowCallsAfterMount = testState.rowDraftCalls;
    rendered.rerender(<ProjectionTree projection={projection} />);
    expect(testState.rowDraftCalls).toBe(rowCallsAfterMount);
  });

  it("removes project-group height and navigation when its region section collapses", () => {
    enableOffscreenWindowing();
    renderProjection(
      {
        regions: [
          region("Collapsible", ["thread-a", "thread-b"], {
            collapsible: true,
            nesting: "native",
            grouping: projectGrouping(["project-a"]),
          }),
        ],
        excludedThreadIds: [],
      },
      { activeThreadId: "thread-b" },
    );
    expect(
      screen.getByRole("link", { name: "Open Independent" }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Collapsible section" }),
    );

    expect(document.querySelector("[data-sidebar-windowed-item]")).toBeNull();
    expect(getSidebarThreadNavigationTargets(document.body)).toEqual([]);
  });

  it("uses one off-screen row and no child navigation for a collapsed project", () => {
    enableOffscreenWindowing();
    renderProjection(
      {
        regions: [
          region("project collapse", ["thread-a", "thread-b"], {
            nesting: "native",
            grouping: projectGrouping(["project-a"], { collapsible: true }),
          }),
        ],
        excludedThreadIds: [],
      },
      { activeThreadId: "thread-b" },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Project A section" }),
    );

    const placeholder = document.querySelector<HTMLElement>(
      "[data-sidebar-windowed-item]",
    );
    expect(placeholder?.style.height).toBe("30px");
    expect(placeholder?.hasAttribute("data-sidebar-windowed-nav")).toBe(false);
    expect(getSidebarThreadNavigationTargets(document.body)).toEqual([]);
  });

  it("publishes native parent order and updates off-screen thread collapse metadata", () => {
    const parent = makeThread("parent", "project-a", { title: "Parent" });
    const child = makeThread("child", "project-a", {
      title: "Child",
      parentThreadId: "parent",
    });
    setNavigation([makeProject("project-a", "Project A", [parent, child])]);
    enableOffscreenWindowing();
    const projection = {
      regions: [
        region("native order", ["child", "parent"], {
          nesting: "native",
          grouping: projectGrouping(["project-a"]),
        }),
      ],
      excludedThreadIds: [],
    } satisfies PluginSidebarThreadProjection;

    const offscreen = renderProjection(projection);
    expect(
      getSidebarThreadNavigationTargets(offscreen.container).map(
        ({ threadId }) => threadId,
      ),
    ).toEqual(["parent", "child"]);
    expect(
      offscreen.container.querySelector<HTMLElement>(
        "[data-sidebar-windowed-item]",
      )?.style.height,
    ).toBe("90px");

    cleanup();
    renderProjection(projection, { activeThreadId: "child" });
    expect(screen.getByRole("link", { name: "Open Child" })).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Parent threads" }),
    );
    const collapsedPlaceholder = document.querySelector<HTMLElement>(
      "[data-sidebar-windowed-item]",
    );
    expect(collapsedPlaceholder?.style.height).toBe("60px");
    expect(
      getSidebarThreadNavigationTargets(document.body).map(
        ({ threadId }) => threadId,
      ),
    ).toEqual(["parent"]);
  });

  it("updates off-screen environment collapse height and navigation", () => {
    const first = makeThread("env-first", "project-a", {
      environmentId: "environment-a",
      environmentName: "Feature tree",
      environmentWorkspaceDisplayKind: "managed-worktree",
    });
    const second = makeThread("env-second", "project-a", {
      environmentId: "environment-a",
      environmentName: "Feature tree",
      environmentWorkspaceDisplayKind: "managed-worktree",
    });
    setNavigation([makeProject("project-a", "Project A", [first, second])]);
    enableOffscreenWindowing();
    renderProjection(
      {
        regions: [
          region("environment", ["env-first", "env-second"], {
            nesting: "native",
            grouping: projectGrouping(["project-a"]),
          }),
        ],
        excludedThreadIds: [],
      },
      { activeThreadId: "env-second" },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Feature tree threads" }),
    );

    const placeholder = document.querySelector<HTMLElement>(
      "[data-sidebar-windowed-item]",
    );
    expect(placeholder?.style.height).toBe("60px");
    expect(getSidebarThreadNavigationTargets(document.body)).toEqual([]);
  });

  it("windows flat rows with placeholder navigation and active retention", () => {
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "clientHeight", { value: 500 });
    testState.scrollElementRef.current = scrollElement;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === scrollElement) return new DOMRect(0, 0, 300, 500);
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          return new DOMRect(0, 2_000, 300, 30);
        }
        return new DOMRect();
      },
    );
    const threads = Array.from({ length: 100 }, (_, index) =>
      makeThread(`flat-${index}`, "project-a"),
    );
    setNavigation([makeProject("project-a", "Project A", threads)]);
    const rendered = renderProjection(
      {
        regions: [
          region(
            "flat",
            threads.map(({ id }) => id),
            { label: null },
          ),
        ],
        excludedThreadIds: [],
      },
      { activeThreadId: "flat-99" },
    );
    expect(
      rendered.container.querySelectorAll("[data-sidebar-thread-id]"),
    ).toHaveLength(1);
    expect(
      rendered.container.querySelector('[data-sidebar-thread-id="flat-99"]'),
    ).not.toBeNull();
    expect(
      rendered.container.querySelectorAll("[data-sidebar-windowed-nav]").length,
    ).toBeGreaterThan(90);
  });

  it("windows 10,000 project groups with navigation placeholders and active retention", () => {
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "clientHeight", { value: 500 });
    testState.scrollElementRef.current = scrollElement;
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this === scrollElement) return new DOMRect(0, 0, 300, 500);
        if (this.hasAttribute("data-sidebar-windowed-item")) {
          return new DOMRect(0, 2_000, 300, 30);
        }
        return new DOMRect();
      },
    );
    const projects = Array.from({ length: 10_000 }, (_, index) => {
      const projectId = `project-${index}`;
      return makeProject(projectId, `Project ${index}`, [
        makeThread(`thread-${index}`, projectId),
      ]);
    });
    setNavigation(projects);
    const rendered = renderProjection(
      {
        regions: [
          region(
            "many",
            projects.map(({ threads }) => threads[0]!.id),
            {
              grouping: projectGrouping(projects.map(({ id }) => id)),
            },
          ),
        ],
        excludedThreadIds: [],
      },
      { activeThreadId: "thread-9999" },
    );
    expect(
      rendered.container.querySelectorAll("[data-sidebar-windowed-item]")
        .length,
    ).toBeLessThanOrEqual(SIDEBAR_WINDOWED_MAX_WRAPPERS * 2);
    expect(
      rendered.container.querySelectorAll("[data-sidebar-project-id]").length,
    ).toBeLessThan(100);
    expect(
      rendered.container.querySelectorAll("[data-sidebar-thread-id]").length,
    ).toBeLessThan(100);
    expect(
      rendered.container.querySelector(
        '[data-sidebar-thread-id="thread-9999"]',
      ),
    ).not.toBeNull();
    expect(getSidebarThreadNavigationTargets(rendered.container)).toHaveLength(
      10_000,
    );
    expect(rendered.container.querySelectorAll("*").length).toBeLessThan(5_000);
  });
});
