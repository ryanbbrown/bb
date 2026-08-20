// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadDisplayTitle } from "./projection";

const FLAT_EDGE_CLASS = "firstmate-flat-edge px-2";

const app = await loadPluginApp(() => import("../app"));
const threadList = app.threadLists[0]!;

function thread(
  id: string,
  title: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "proj_bb",
    title,
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
  { id: "proj_site", name: "Marketing site", isPersonal: false },
  { id: "proj_empty", name: "No active work", isPersonal: false },
];

const listProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
  experimental_Original: () => <p>Original BB sidebar</p>,
};

function renderFirstmate(
  threads: PluginSidebarThread[],
  options: {
    activeThreadId?: string | null;
    managerThreadId?: string;
    onNavigate?: () => void;
    searchQuery?: string;
    status?: "loading" | "ready" | "error";
    projects?: typeof projects;
  } = {},
) {
  return renderSlot(
    threadList,
    {
      ...listProps,
      activeThreadId: options.activeThreadId ?? null,
      onNavigate: options.onNavigate ?? listProps.onNavigate,
      searchQuery: options.searchQuery ?? "",
    },
    {
      settings: {
        managerThreadId: options.managerThreadId ?? "manager",
      },
      sidebarThreads: {
        status: options.status ?? "ready",
        threads,
        projects: options.projects ?? projects,
      },
    },
  );
}

function standardThreads() {
  return [
    thread("manager", "Coordinate Firstmate"),
    thread("managed-bb", "Fix sidebar", { parentThreadId: "manager" }),
    thread("managed-site", "Write launch copy", {
      parentThreadId: "manager",
      projectId: "proj_site",
    }),
    thread("independent", "Investigate cache"),
  ];
}

afterEach(cleanup);

describe("Firstmate sidebar registration", () => {
  it("registers one official thread-list replacement", () => {
    expect(app.threadLists).toHaveLength(1);
    expect(threadList.id).toBe("firstmate");
  });
});

describe("FirstmateThreadList", () => {
  it("pins one manager row at the top and separates it from the regions", () => {
    renderFirstmate(standardThreads());

    const managerRegion = document.querySelector(
      '[data-firstmate-region="manager"]',
    );
    expect(managerRegion).not.toBeNull();
    expect(
      within(managerRegion as HTMLElement).getAllByRole("link"),
    ).toHaveLength(1);
    expect(
      within(managerRegion as HTMLElement).getByRole("link", {
        name: "Coordinate Firstmate",
      }),
    ).toBeDefined();
    expect(screen.getByLabelText("Manager fixed at top")).toBeDefined();
    expect(
      screen.getByRole("separator", { name: "Firstmate manager divider" }),
    ).toBeDefined();

    const firstLink = screen.getAllByRole("link")[0];
    expect(firstLink.getAttribute("data-sidebar-thread-id")).toBe("manager");
  });

  it("uses one flat left edge for headings, project labels, and thread rows", () => {
    renderFirstmate(standardThreads());
    const managed = screen.getByRole("region", { name: "Managed sessions" });
    const heading = within(managed).getByRole("heading", {
      name: "Managed sessions",
    });
    const projectLabel = within(managed).getByRole("heading", { name: "BB" });
    const row = within(managed)
      .getByRole("link", { name: "Fix sidebar" })
      .closest("li");

    for (const element of [heading, projectLabel, row]) {
      expect(element?.hasAttribute("data-firstmate-flat-edge")).toBe(true);
      expect(element?.className).toContain(FLAT_EDGE_CLASS);
    }
    expect(within(managed).queryByRole("tree")).toBeNull();
    expect(row?.closest("ul")?.className).toContain("p-0");
    const projectLeading = projectLabel.querySelector(
      "[data-firstmate-leading-edge]",
    );
    const rowLeading = row?.querySelector("[data-firstmate-leading-edge]");
    expect(projectLeading?.className).toContain("size-5");
    expect(rowLeading?.className).toContain("size-5");
  });

  it("partitions only direct manager children as managed", () => {
    renderFirstmate([
      thread("manager", "Manager"),
      thread("direct", "Direct child", { parentThreadId: "manager" }),
      thread("grandchild", "Nested child", { parentThreadId: "direct" }),
      thread("other-child", "Someone else's child", {
        parentThreadId: "another-manager",
      }),
    ]);

    const managed = screen.getByRole("region", { name: "Managed sessions" });
    const independent = screen.getByRole("region", {
      name: "Independent threads",
    });
    expect(within(managed).getByText("Direct child")).toBeDefined();
    expect(within(managed).queryByText("Nested child")).toBeNull();
    expect(within(independent).getByText("Nested child")).toBeDefined();
    expect(within(independent).getByText("Someone else's child")).toBeDefined();
  });

  it("groups both regions by real project name and omits empty projects", () => {
    renderFirstmate([
      ...standardThreads(),
      thread("archived-site", "Archived project work", {
        projectId: "proj_empty",
        isArchived: true,
      }),
    ]);
    const managed = screen.getByRole("region", { name: "Managed sessions" });
    const independent = screen.getByRole("region", {
      name: "Independent threads",
    });

    expect(within(managed).getByRole("heading", { name: "BB" })).toBeDefined();
    expect(
      within(managed).getByRole("heading", { name: "Marketing site" }),
    ).toBeDefined();
    expect(
      within(independent).getByRole("heading", { name: "BB" }),
    ).toBeDefined();
    expect(screen.queryByText("No active work")).toBeNull();
    expect(screen.queryByText("Archived project work")).toBeNull();
  });

  it("moves a detached thread immediately to Independent", () => {
    const attached = renderFirstmate([
      thread("manager", "Manager"),
      thread("optimize", "Optimize goal", { parentThreadId: "manager" }),
    ]);
    expect(
      within(
        screen.getByRole("region", { name: "Managed sessions" }),
      ).getByText("Optimize goal"),
    ).toBeDefined();
    attached.unmount();

    renderFirstmate([
      thread("manager", "Manager"),
      thread("optimize", "Optimize goal", { parentThreadId: null }),
    ]);
    expect(
      within(
        screen.getByRole("region", { name: "Independent threads" }),
      ).getByText("Optimize goal"),
    ).toBeDefined();
  });

  it("filters manager and session rows with the host search query", () => {
    renderFirstmate(standardThreads(), { searchQuery: "launch" });
    expect(screen.queryByText("Coordinate Firstmate")).toBeNull();
    expect(screen.getByText("Write launch copy")).toBeDefined();
    expect(screen.queryByText("Fix sidebar")).toBeNull();
    expect(screen.queryByText("Investigate cache")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("shows active, unread, pinned, and attention state without changing groups", () => {
    renderFirstmate(
      [
        thread("manager", "Manager"),
        thread("attention", "Needs a decision", {
          parentThreadId: "manager",
          indicator: "waiting-for-input",
          indicatorLabel: "Thread needs user input",
          isUnread: true,
          isPinned: true,
        }),
      ],
      { activeThreadId: "attention" },
    );

    const row = screen.getByRole("link", { name: "Needs a decision" });
    expect(row.getAttribute("aria-current")).toBe("page");
    expect(row.parentElement?.className).toContain("bg-sidebar-accent");
    expect(screen.getByLabelText("Pinned thread")).toBeDefined();
    expect(screen.getByLabelText("Unread thread")).toBeDefined();
    expect(screen.getByLabelText("Thread needs user input")).toBeDefined();
    expect(
      within(
        screen.getByRole("region", { name: "Managed sessions" }),
      ).getByText("Needs a decision"),
    ).toBeDefined();
  });

  it("keeps the host keyboard-navigation attributes on every row", () => {
    renderFirstmate(standardThreads());
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link.hasAttribute("data-sidebar-thread-shortcut-target")).toBe(
        true,
      );
      expect(link.getAttribute("data-sidebar-thread-id")).toMatch(
        /manager|managed-bb|managed-site|independent/,
      );
    }
  });

  it("opens through the host, supports modifier split, and calls onNavigate", () => {
    let navigations = 0;
    const rendered = renderFirstmate(standardThreads(), {
      onNavigate: () => {
        navigations += 1;
      },
    });
    const link = screen.getByRole("link", { name: "Fix sidebar" });

    fireEvent.click(link);
    fireEvent.click(link, { metaKey: true });

    expect(rendered.inspection.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "managed-bb",
      options: { split: false },
    });
    expect(rendered.inspection.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "managed-bb",
      options: { split: true },
    });
    expect(navigations).toBe(2);
  });

  it("spreads the host split-drag binding onto rows", () => {
    const rendered = renderFirstmate(standardThreads());
    fireEvent.pointerDown(screen.getByRole("link", { name: "Fix sidebar" }));
    expect(rendered.inspection.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "managed-bb",
    });
  });

  it("opens in split from the visible menu and clears host navigation state", () => {
    let navigations = 0;
    const rendered = renderFirstmate(standardThreads(), {
      onNavigate: () => {
        navigations += 1;
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Fix sidebar" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));
    expect(rendered.inspection.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "managed-bb",
      options: { split: true },
    });
    expect(navigations).toBe(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("supports keyboard navigation and Escape in the action menu", () => {
    renderFirstmate(standardThreads());
    const trigger = screen.getByRole("button", {
      name: "Actions for Fix sidebar",
    });
    fireEvent.click(trigger);
    const menu = screen.getByRole("menu", { name: "Thread actions" });
    expect(menu.hasAttribute("data-bb-plugin-root")).toBe(true);
    expect(menu.hasAttribute("data-bb-portaled-overlay")).toBe(true);
    expect(menu.className).toContain("fixed");
    expect(document.activeElement?.textContent).toBe("Open in split");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Mark unread");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("routes Delete through the host confirmation action", () => {
    const rendered = renderFirstmate(standardThreads());
    fireEvent.click(
      screen.getByRole("button", { name: "Actions for Fix sidebar" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(rendered.inspection.sidebarActionCalls).toContainEqual({
      method: "requestDelete",
      threadId: "managed-bb",
    });
  });
});

describe("display titles", () => {
  it("preserves stored text and keeps unnamed rows distinct", () => {
    expect(threadDisplayTitle(thread("one", "  Keep my spacing  "))).toBe(
      "  Keep my spacing  ",
    );
    expect(
      threadDisplayTitle(
        thread("two", "Ignored", { title: null, titleFallback: null }),
      ),
    ).toBe("Untitled thread (two)");
  });
});

describe("safe fallback", () => {
  it.each([
    ["not configured", [], "", "ready"],
    ["loading", standardThreads(), "manager", "loading"],
    ["thread load error", standardThreads(), "manager", "error"],
    ["missing manager", [thread("other", "Other")], "manager", "ready"],
    [
      "archived manager",
      [thread("manager", "Manager", { isArchived: true })],
      "manager",
      "ready",
    ],
    [
      "duplicated manager",
      [thread("manager", "One"), thread("manager", "Two")],
      "manager",
      "ready",
    ],
  ] as const)(
    "renders BB's original list when the manager is %s",
    (_name, threads, managerThreadId, status) => {
      renderFirstmate([...threads], { managerThreadId, status });
      expect(screen.getByText("Original BB sidebar")).toBeDefined();
    },
  );

  it("falls back when a visible thread's project cannot be projected", () => {
    renderFirstmate([
      thread("manager", "Manager"),
      thread("unknown-project", "Unknown", { projectId: "missing" }),
    ]);
    expect(screen.getByText("Original BB sidebar")).toBeDefined();
  });

  it("falls back when project names are blank", () => {
    renderFirstmate([thread("manager", "Manager")], {
      projects: [{ id: "proj_bb", name: "  ", isPersonal: false }],
    });
    expect(screen.getByText("Original BB sidebar")).toBeDefined();
  });
});
