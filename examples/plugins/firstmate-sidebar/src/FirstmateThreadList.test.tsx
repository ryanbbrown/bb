// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginSidebarThread,
  PluginSidebarThreadProjection,
} from "@get-bb/plugin-sdk/app";

const projectionTestState = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./projection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./projection")>();
  return {
    ...actual,
    projectFirstmateThreads: (
      ...args: Parameters<typeof actual.projectFirstmateThreads>
    ) => {
      projectionTestState.calls += 1;
      return actual.projectFirstmateThreads(...args);
    },
  };
});

const app = await loadPluginApp(() => import("../app"));
const threadList = app.threadLists[0]!;

function thread(
  id: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "proj_bb",
    title: id,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    visibility: "visible",
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 100,
    lastReadAt: 100,
    latestAttentionAt: 100,
    ...overrides,
  };
}

const projects = [
  { id: "proj_bb", name: "BB", isPersonal: false },
  { id: "proj_site", name: "Site", isPersonal: false },
  { id: "proj_empty", name: "Empty", isPersonal: false },
];

const listProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
  experimental_Original: () => <p>Original BB sidebar</p>,
  experimental_SidebarThreadProjection: () => null,
};

function renderFirstmate(
  threads: PluginSidebarThread[],
  options: {
    managerThreadId?: string;
    status?: "loading" | "ready" | "error";
  } = {},
) {
  return renderSlot(threadList, listProps, {
    settings: { managerThreadId: options.managerThreadId ?? "manager" },
    sidebarThreads: {
      status: options.status ?? "ready",
      threads,
      projects,
    },
  });
}

function submittedProjection(
  rendered: ReturnType<typeof renderFirstmate>,
): PluginSidebarThreadProjection {
  expect(rendered.inspection.sidebarThreadProjections).toHaveLength(1);
  return rendered.inspection.sidebarThreadProjections[0]!;
}

function standardThreads() {
  return [
    thread("manager"),
    thread("managed-bb", { parentThreadId: "manager" }),
    thread("managed-site", {
      parentThreadId: "manager",
      projectId: "proj_site",
    }),
    thread("independent"),
  ];
}

beforeEach(() => {
  projectionTestState.calls = 0;
});

afterEach(cleanup);

describe("Firstmate sidebar registration", () => {
  it("registers one thread-list replacement", () => {
    expect(app.threadLists).toHaveLength(1);
    expect(threadList.id).toBe("firstmate");
  });
});

describe("Firstmate ID projection", () => {
  it("submits the manager, managed, and independent regions", () => {
    const projection = submittedProjection(renderFirstmate(standardThreads()));

    expect(projection).toEqual({
      regions: [
        {
          id: "manager",
          label: null,
          placement: "sticky",
          dividerAfter: true,
          collapsible: false,
          nesting: "flat",
          grouping: { kind: "none" },
          threadOrder: ["manager"],
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
            projectOrder: ["proj_bb", "proj_site", "proj_empty"],
            collapsible: false,
            showEmptyProjects: false,
          },
          threadOrder: ["managed-bb", "managed-site"],
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
            projectOrder: ["proj_bb", "proj_site", "proj_empty"],
            collapsible: false,
            showEmptyProjects: false,
          },
          threadOrder: ["independent"],
        },
      ],
      excludedThreadIds: [],
    });
  });

  it("keeps project-array and source-thread order", () => {
    const projection = submittedProjection(
      renderFirstmate([
        thread("manager"),
        thread("site-first", {
          parentThreadId: "manager",
          projectId: "proj_site",
        }),
        thread("bb-second", { parentThreadId: "manager" }),
      ]),
    );
    const managed = projection.regions[1]!;
    expect(managed.threadOrder).toEqual(["site-first", "bb-second"]);
    expect(
      managed.grouping.kind === "project" ? managed.grouping.projectOrder : [],
    ).toEqual(["proj_bb", "proj_site", "proj_empty"]);
  });

  it("puts only direct children in Managed sessions", () => {
    const projection = submittedProjection(
      renderFirstmate([
        thread("manager"),
        thread("direct", { parentThreadId: "manager" }),
        thread("grandchild", { parentThreadId: "direct" }),
        thread("other", { parentThreadId: "different-manager" }),
      ]),
    );
    expect(projection.regions[1]!.threadOrder).toEqual(["direct"]);
    expect(projection.regions[2]!.threadOrder).toEqual(["grandchild", "other"]);
  });

  it("moves a detached direct child to Independent on the next snapshot", () => {
    const attached = submittedProjection(
      renderFirstmate([
        thread("manager"),
        thread("task", { parentThreadId: "manager" }),
      ]),
    );
    cleanup();
    const detached = submittedProjection(
      renderFirstmate([thread("manager"), thread("task")]),
    );
    expect(attached.regions[1]!.threadOrder).toEqual(["task"]);
    expect(detached.regions[2]!.threadOrder).toEqual(["task"]);
  });

  it("omits archived and hidden non-manager threads from all IDs", () => {
    const projection = submittedProjection(
      renderFirstmate([
        ...standardThreads(),
        thread("archived", { isArchived: true }),
        thread("hidden", { visibility: "hidden" }),
      ]),
    );
    const projectedIds = projection.regions.flatMap(
      (region) => region.threadOrder,
    );
    expect(projectedIds).not.toContain("archived");
    expect(projectedIds).not.toContain("hidden");
    expect(projection.excludedThreadIds).toEqual([]);
  });

  it("keeps projection construction stable across unchanged rerenders", () => {
    const rendered = renderFirstmate(standardThreads());
    const Component = threadList.component;
    expect(projectionTestState.calls).toBe(1);

    rendered.lifecycle.rerender(<Component {...listProps} />);

    expect(projectionTestState.calls).toBe(1);
  });

  it("uses the SDK harness semantic adapter without custom row markup", () => {
    renderFirstmate(standardThreads());
    expect(
      screen.getByRole("region", { name: "Managed sessions" }),
    ).toBeDefined();
    expect(document.querySelector("[data-firstmate-thread-row]")).toBeNull();
  });
});

describe("safe deliberate fallback", () => {
  it("renders Original when the manager setting is missing", () => {
    const rendered = renderSlot(threadList, listProps, {
      sidebarThreads: {
        status: "ready",
        threads: standardThreads(),
        projects,
      },
    });
    expect(screen.getByText("Original BB sidebar")).toBeDefined();
    expect(rendered.inspection.sidebarThreadProjections).toHaveLength(0);
    expect(projectionTestState.calls).toBe(0);
  });

  it.each([
    ["blank manager", standardThreads(), "", "ready"],
    ["whitespace manager", standardThreads(), " manager ", "ready"],
    ["loading threads", standardThreads(), "manager", "loading"],
    ["thread error", standardThreads(), "manager", "error"],
    ["missing manager", [thread("other")], "manager", "ready"],
    [
      "archived manager",
      [thread("manager", { isArchived: true })],
      "manager",
      "ready",
    ],
    [
      "hidden manager",
      [thread("manager", { visibility: "hidden" })],
      "manager",
      "ready",
    ],
    [
      "duplicate manager",
      [thread("manager"), thread("manager")],
      "manager",
      "ready",
    ],
  ] as const)("renders Original for %s", (_name, threads, id, status) => {
    const rendered = renderFirstmate([...threads], {
      managerThreadId: id,
      status,
    });
    expect(screen.getByText("Original BB sidebar")).toBeDefined();
    expect(rendered.inspection.sidebarThreadProjections).toHaveLength(0);
  });
});
