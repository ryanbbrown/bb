// @vitest-environment jsdom

import { useMemo, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createStore, Provider as JotaiProvider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import type { experimental_PluginSidebarThreadProjection } from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";

const mocks = vi.hoisted(() => ({
  archiveThreadAndChildren: vi.fn(),
  navigation: { data: undefined as SidebarBootstrapResponse | undefined },
  renameThread: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError, success: vi.fn(), message: vi.fn() },
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/sidebar-navigation-query")
  >()),
  useSidebarNavigation: () => mocks.navigation,
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: mocks.archiveThreadAndChildren,
    renameThread: mocks.renameThread,
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

import {
  BoundSidebarThreadProjection,
  resetSidebarProjectionDiagnosticsForTest,
  SidebarThreadProjectionBindingProvider,
} from "./SidebarThreadProjectionRenderer";
import {
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutAssignmentsContext,
  type SidebarThreadShortcutAssignment,
} from "./sidebarThreadShortcuts";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_a",
    projectId: "proj_a",
    environmentId: null,
    providerId: "codex",
    title: "Thread",
    titleFallback: "Thread",
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
    createdAt: 1,
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

function makeProject(
  id: string,
  name: string,
  threads: ThreadListEntry[],
): ProjectWithThreadsResponse {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
    threads,
    defaultExecutionOptions: null,
  };
}

function makeBootstrap(
  projects: ProjectWithThreadsResponse[],
  personalThreads: ThreadListEntry[] = [],
): SidebarBootstrapResponse {
  return {
    sections: [],
    projects,
    personalProject: makeProject("proj_personal", "Personal", personalThreads),
  };
}

function makeRegion(
  overrides: Partial<
    experimental_PluginSidebarThreadProjection["regions"][number]
  > = {},
): experimental_PluginSidebarThreadProjection["regions"][number] {
  return {
    id: "region-a",
    label: "Region A",
    placement: "sticky",
    dividerAfter: false,
    collapsible: false,
    nesting: "native",
    grouping: { kind: "none" },
    threadOrder: [],
    ...overrides,
  };
}

function OriginalList() {
  return <div data-testid="original-list" />;
}

/**
 * Mirrors what `AppSidebar` does with the DOM: read the thread rows in
 * document order and hand each one its number.
 */
function ThreadNumbering({
  children,
  root,
}: {
  children: ReactNode;
  root: HTMLElement | null;
}) {
  const assignments = useMemo(() => {
    const map = new Map<string, SidebarThreadShortcutAssignment>();
    for (const target of getSidebarThreadShortcutTargets(root)) {
      map.set(target.threadId, { number: target.key, shortcut: null });
    }
    return map;
  }, [root]);
  return (
    <SidebarThreadShortcutAssignmentsContext.Provider value={assignments}>
      {children}
    </SidebarThreadShortcutAssignmentsContext.Provider>
  );
}

interface HarnessOptions {
  activeThreadId?: string | null;
  isCompactViewport?: boolean;
  isSearchFieldOpen?: boolean;
  numberingRoot?: HTMLElement | null;
  projection: experimental_PluginSidebarThreadProjection;
}

function Harness({
  activeThreadId = null,
  isCompactViewport = false,
  isSearchFieldOpen = false,
  numberingRoot = null,
  projection,
}: HarnessOptions) {
  return (
    <JotaiProvider store={createStore()}>
      <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
        <TooltipProvider>
          <MemoryRouter>
            <ThreadNumbering root={numberingRoot}>
              <SidebarThreadProjectionBindingProvider
                activeThreadId={activeThreadId}
                generation={1}
                isSearchFieldOpen={isSearchFieldOpen}
                onNavigate={() => {}}
                Original={OriginalList}
                pluginId="firstmate"
                registrationId="sidebar"
              >
                <BoundSidebarThreadProjection projection={projection} />
              </SidebarThreadProjectionBindingProvider>
            </ThreadNumbering>
          </MemoryRouter>
        </TooltipProvider>
      </CompactViewportOverrideProvider>
    </JotaiProvider>
  );
}

function renderProjection(options: HarnessOptions) {
  const result = render(<Harness {...options} />);
  return {
    ...result,
    rerenderWith(next: HarnessOptions) {
      result.rerender(<Harness {...next} />);
    },
  };
}

function renderedThreadIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-sidebar-thread-id]")].map(
    (element) => element.getAttribute("data-sidebar-thread-id") ?? "",
  );
}

describe("SidebarThreadProjectionRenderer", () => {
  beforeEach(() => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [
        makeThread({ id: "thr_a1", title: "Alpha one" }),
        makeThread({ id: "thr_a2", title: "Alpha two" }),
      ]),
      makeProject("proj_b", "Beta", [
        makeThread({ id: "thr_b1", projectId: "proj_b", title: "Beta one" }),
      ]),
    ]);
  });

  afterEach(() => {
    cleanup();
    resetSidebarProjectionDiagnosticsForTest();
    vi.clearAllMocks();
  });

  it("renders every region's rows in the declared order", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "pinned",
            label: "Pinned",
            threadOrder: ["thr_b1"],
          }),
          makeRegion({
            id: "rest",
            label: "Everything else",
            placement: "flow",
            threadOrder: ["thr_a2", "thr_a1"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(screen.getByTitle("Pinned")).not.toBeNull();
    expect(screen.getByTitle("Everything else")).not.toBeNull();
    expect(renderedThreadIds(container)).toEqual([
      "thr_b1",
      "thr_a2",
      "thr_a1",
    ]);
  });

  it("numbers rows 1..9 in DOM order across region boundaries", () => {
    const threads = Array.from({ length: 10 }, (_value, index) =>
      makeThread({ id: `thr_${index}`, title: `Thread ${index}` }),
    );
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", threads),
    ]);

    const { container, rerenderWith } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "top",
            label: "Top",
            threadOrder: ["thr_0", "thr_1", "thr_2", "thr_3"],
          }),
          makeRegion({
            id: "bottom",
            label: "Bottom",
            placement: "flow",
            threadOrder: ["thr_4", "thr_5", "thr_6", "thr_7", "thr_8", "thr_9"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    const targets = getSidebarThreadShortcutTargets(container);
    expect(targets.map((target) => target.key)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    expect(targets.map((target) => target.threadId)).toEqual([
      "thr_0",
      "thr_1",
      "thr_2",
      "thr_3",
      "thr_4",
      "thr_5",
      "thr_6",
      "thr_7",
      "thr_8",
    ]);

    // Feed the numbering back in, exactly as AppSidebar's observer does.
    rerenderWith({
      numberingRoot: container,
      projection: {
        regions: [
          makeRegion({
            id: "top",
            label: "Top",
            threadOrder: ["thr_0", "thr_1", "thr_2", "thr_3"],
          }),
          makeRegion({
            id: "bottom",
            label: "Bottom",
            placement: "flow",
            threadOrder: ["thr_4", "thr_5", "thr_6", "thr_7", "thr_8", "thr_9"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    const numbers = [
      ...container.querySelectorAll("[data-sidebar-thread-number]"),
    ].map((element) => element.textContent);
    expect(numbers).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("never renders a hidden thread and matches native eligibility", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [
        makeThread({ id: "thr_visible" }),
        makeThread({ id: "thr_hidden", visibility: "hidden" }),
      ]),
    ]);

    const { container } = renderProjection({
      projection: {
        regions: [makeRegion({ threadOrder: ["thr_visible", "thr_hidden"] })],
        excludedThreadIds: [],
      },
    });

    // A plugin cannot see `visibility`, so naming a hidden thread drops that
    // id rather than costing the user the whole projection.
    expect(screen.queryByTestId("original-list")).toBeNull();
    expect(renderedThreadIds(container)).toEqual(["thr_visible"]);
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("renders a projection that leaves a hidden thread unplaced", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [
        makeThread({ id: "thr_visible" }),
        makeThread({ id: "thr_hidden", visibility: "hidden" }),
      ]),
    ]);

    const { container } = renderProjection({
      projection: {
        regions: [makeRegion({ threadOrder: ["thr_visible"] })],
        excludedThreadIds: [],
      },
    });

    expect(screen.queryByTestId("original-list")).toBeNull();
    expect(renderedThreadIds(container)).toEqual(["thr_visible"]);
  });

  // The query text never reaches the renderer, so an open field with an empty
  // query bypasses the projection exactly like an open field with a query.
  // `PluginThreadList.test.tsx` covers both query states reaching this flag.
  it("renders BB's own list while the search field is open", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [makeThread({ id: "thr_a1" })]),
    ]);
    const projection = {
      regions: [makeRegion({ threadOrder: ["thr_a1"] })],
      excludedThreadIds: [],
    };

    const { container, rerenderWith } = renderProjection({
      isSearchFieldOpen: true,
      projection,
    });
    expect(screen.getByTestId("original-list")).not.toBeNull();
    expect(renderedThreadIds(container)).toEqual([]);

    rerenderWith({ isSearchFieldOpen: false, projection });
    expect(screen.queryByTestId("original-list")).toBeNull();
    expect(renderedThreadIds(container)).toEqual(["thr_a1"]);
  });

  it("falls back with one deduplicated diagnostic and recovers", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [
        makeThread({ id: "thr_a1" }),
        makeThread({ id: "thr_a2" }),
      ]),
    ]);
    const invalidProjection = {
      regions: [makeRegion({ threadOrder: ["thr_a1"] })],
      excludedThreadIds: [],
    };

    const { container, rerenderWith } = renderProjection({
      projection: invalidProjection,
    });
    expect(screen.getByTestId("original-list")).not.toBeNull();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError.mock.calls[0]?.[1]?.description).toContain(
      "firstmate",
    );

    rerenderWith({
      projection: {
        regions: [makeRegion({ threadOrder: ["thr_a1"] })],
        excludedThreadIds: [],
      },
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    rerenderWith({
      projection: {
        regions: [makeRegion({ threadOrder: ["thr_a1", "thr_a2"] })],
        excludedThreadIds: [],
      },
    });
    expect(screen.queryByTestId("original-list")).toBeNull();
    expect(renderedThreadIds(container)).toEqual(["thr_a1", "thr_a2"]);
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it("reports a second distinct failure reason once", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [makeThread({ id: "thr_a1" })]),
    ]);

    const { rerenderWith } = renderProjection({
      projection: {
        regions: [makeRegion({ threadOrder: ["thr_missing"] })],
        excludedThreadIds: [],
      },
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(1);

    rerenderWith({
      projection: {
        regions: [makeRegion({ id: "  ", threadOrder: [] })],
        excludedThreadIds: ["thr_a1"],
      },
    });
    expect(mocks.toastError).toHaveBeenCalledTimes(2);
  });

  it("pins a sticky region's heading and lets a flow region's scroll", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "pinned",
            label: "Pinned",
            placement: "sticky",
            threadOrder: ["thr_b1"],
          }),
          makeRegion({
            id: "rest",
            label: "Rest",
            placement: "flow",
            threadOrder: ["thr_a1", "thr_a2"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    const sticky = container.querySelector(
      '[data-sidebar-projection-region="pinned"]',
    );
    const flow = container.querySelector(
      '[data-sidebar-projection-region="rest"]',
    );
    expect(sticky?.closest("[data-sidebar-sticky-stack]")).not.toBeNull();
    expect(flow?.closest("[data-sidebar-sticky-stack]")).toBeNull();
  });

  it("draws a divider after a region but never after the last one", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "one",
            label: "One",
            dividerAfter: true,
            threadOrder: ["thr_b1"],
          }),
          makeRegion({
            id: "two",
            label: "Two",
            placement: "flow",
            dividerAfter: true,
            threadOrder: ["thr_a1", "thr_a2"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it("collapses a region and hides its rows", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "one",
            label: "One",
            collapsible: true,
            threadOrder: ["thr_a1", "thr_a2", "thr_b1"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(renderedThreadIds(container)).toHaveLength(3);
    fireEvent.click(
      screen.getByRole("button", { name: "Collapse One section" }),
    );
    expect(renderedThreadIds(container)).toEqual([]);
  });

  it("splits a region into project groups in the declared order", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "byproject",
            label: "By project",
            threadOrder: ["thr_a1", "thr_b1", "thr_a2"],
            grouping: {
              kind: "project",
              projectOrder: ["proj_b", "proj_a"],
              collapsible: true,
              showEmptyProjects: false,
            },
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(screen.getByTitle("Beta")).not.toBeNull();
    expect(screen.getByTitle("Alpha")).not.toBeNull();
    expect(renderedThreadIds(container)).toEqual([
      "thr_b1",
      "thr_a1",
      "thr_a2",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Beta section" }),
    );
    expect(renderedThreadIds(container)).toEqual(["thr_a1", "thr_a2"]);
  });

  it("nests a child natively and flattens it for a flat region", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [
        makeThread({ id: "thr_parent", title: "Parent" }),
        makeThread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          title: "Child",
        }),
      ]),
    ]);
    const region = (
      nesting: "flat" | "native",
    ): experimental_PluginSidebarThreadProjection => ({
      regions: [
        makeRegion({ nesting, threadOrder: ["thr_parent", "thr_child"] }),
      ],
      excludedThreadIds: [],
    });

    const { container, rerenderWith } = renderProjection({
      projection: region("native"),
    });
    expect(
      screen.getByRole("button", { name: "Collapse Parent threads" }),
    ).not.toBeNull();
    expect(renderedThreadIds(container)).toEqual(["thr_parent", "thr_child"]);

    rerenderWith({ projection: region("flat") });
    expect(
      screen.queryByRole("button", { name: "Collapse Parent threads" }),
    ).toBeNull();
    expect(renderedThreadIds(container)).toEqual(["thr_parent", "thr_child"]);
  });

  it("keeps the display-options menu reachable", () => {
    renderProjection({
      projection: {
        regions: [
          makeRegion({
            label: "Region A",
            threadOrder: ["thr_a1", "thr_a2", "thr_b1"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    const trigger = screen.getByRole("button", {
      name: "Sidebar display options",
    });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
  });

  // BB's sidebar carries one display-options menu. Two identically-labelled
  // buttons would be an accessibility regression, not a feature.
  it.each([
    [
      "two labeled regions",
      {
        regions: [
          makeRegion({ id: "one", label: "One", threadOrder: ["thr_b1"] }),
          makeRegion({
            id: "two",
            label: "Two",
            placement: "flow" as const,
            threadOrder: ["thr_a1", "thr_a2"],
          }),
        ],
        excludedThreadIds: [],
      },
    ],
    [
      "one headerless region",
      {
        regions: [
          makeRegion({
            label: null,
            threadOrder: ["thr_a1", "thr_a2", "thr_b1"],
          }),
        ],
        excludedThreadIds: [],
      },
    ],
    [
      "a labeled region beside a headerless one",
      {
        regions: [
          makeRegion({ id: "one", label: null, threadOrder: ["thr_b1"] }),
          makeRegion({
            id: "two",
            label: "Two",
            placement: "flow" as const,
            threadOrder: ["thr_a1", "thr_a2"],
          }),
        ],
        excludedThreadIds: [],
      },
    ],
    [
      "a fully excluded projection",
      {
        regions: [],
        excludedThreadIds: ["thr_a1", "thr_a2", "thr_b1"],
      },
    ],
  ])(
    "shows exactly one display-options control for %s",
    (_name, projection) => {
      renderProjection({ projection });

      expect(
        screen.getAllByRole("button", { name: "Sidebar display options" }),
      ).toHaveLength(1);
    },
  );

  it("shows exactly one display-options control for an empty sidebar", () => {
    mocks.navigation.data = makeBootstrap([]);
    renderProjection({
      projection: { regions: [], excludedThreadIds: [] },
    });

    expect(
      screen.getAllByRole("button", { name: "Sidebar display options" }),
    ).toHaveLength(1);
  });

  it("renders every row on a compact viewport", () => {
    const { container } = renderProjection({
      isCompactViewport: true,
      projection: {
        regions: [
          makeRegion({
            label: "Region A",
            threadOrder: ["thr_a1", "thr_a2", "thr_b1"],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(renderedThreadIds(container)).toEqual([
      "thr_a1",
      "thr_a2",
      "thr_b1",
    ]);
    expect(
      screen.getByRole("button", { name: "Sidebar display options" }),
    ).not.toBeNull();
  });

  it("renders BB's own list before the sidebar snapshot arrives", () => {
    mocks.navigation.data = undefined;
    renderProjection({
      projection: { regions: [], excludedThreadIds: [] },
    });

    expect(screen.getByTestId("original-list")).not.toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("shows an empty state when the projection places no threads", () => {
    mocks.navigation.data = makeBootstrap([]);
    renderProjection({
      projection: { regions: [], excludedThreadIds: [] },
    });

    expect(screen.getByText("No threads")).not.toBeNull();
    expect(screen.queryByTestId("original-list")).toBeNull();
  });

  it("renders a heading for a listed empty project", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            label: "By project",
            threadOrder: ["thr_a1", "thr_a2", "thr_b1"],
            grouping: {
              kind: "project",
              projectOrder: ["proj_a", "proj_b", "proj_personal"],
              collapsible: false,
              showEmptyProjects: true,
            },
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(screen.getByTitle("Personal")).not.toBeNull();
    expect(renderedThreadIds(container)).toEqual([
      "thr_a1",
      "thr_a2",
      "thr_b1",
    ]);
  });

  it("drops a divider whose following region renders nothing", () => {
    const { container } = renderProjection({
      projection: {
        regions: [
          makeRegion({
            id: "one",
            label: "One",
            dividerAfter: true,
            threadOrder: ["thr_a1", "thr_a2", "thr_b1"],
          }),
          // Empty regions are dropped, so the divider above would separate
          // the list from nothing.
          makeRegion({
            id: "two",
            label: "Two",
            placement: "flow",
            threadOrder: [],
          }),
        ],
        excludedThreadIds: [],
      },
    });

    expect(screen.queryByTitle("Two")).toBeNull();
    expect(container.querySelectorAll('[role="separator"]')).toHaveLength(0);
  });

  it("keeps a windowed project group's navigation order and collapse state", () => {
    mocks.navigation.data = makeBootstrap([
      makeProject("proj_a", "Alpha", [
        makeThread({ id: "thr_parent", title: "Parent" }),
        makeThread({
          id: "thr_child",
          parentThreadId: "thr_parent",
          title: "Child",
        }),
      ]),
    ]);
    const projection: experimental_PluginSidebarThreadProjection = {
      regions: [
        makeRegion({
          label: "By project",
          nesting: "native",
          threadOrder: ["thr_parent", "thr_child"],
          grouping: {
            kind: "project",
            projectOrder: ["proj_a"],
            collapsible: false,
            showEmptyProjects: false,
          },
        }),
      ],
      excludedThreadIds: [],
    };
    const { container } = renderProjection({ projection });

    // Placeholders publish the same threads, in the same order, that the
    // mounted rows expose to DOM-order navigation.
    const navigationOrder = () =>
      getSidebarThreadNavigationTargets(container).map(
        (target) => target.threadId,
      );
    expect(navigationOrder()).toEqual(["thr_parent", "thr_child"]);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Parent threads" }),
    );
    expect(navigationOrder()).toEqual(["thr_parent"]);
  });
});
