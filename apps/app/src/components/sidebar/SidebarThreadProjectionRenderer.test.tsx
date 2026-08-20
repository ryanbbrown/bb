// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { PluginSidebarThreadProjection } from "@get-bb/plugin-sdk";

const { toastError, warn } = vi.hoisted(() => ({
  toastError: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.spyOn(console, "warn").mockImplementation(warn);
vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));
vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => true,
  usePromptDraftInputThreadIds: () => new Set(["thread-a"]),
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
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
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
  useSidebarNavigation: () => ({
    data: {
      projects: [
        {
          id: "project-a",
          name: "Project A",
          kind: "standard",
          gitRemoteUrl: null,
          sources: [],
          createdAt: 0,
          updatedAt: 0,
          threads: ["thread-a", "thread-b"].map((id, index) => ({
            id,
            projectId: "project-a",
            environmentId: null,
            providerId: "codex",
            title: id === "thread-a" ? "Manager" : "Independent",
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
            createdAt: index,
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
            runtime: {
              displayStatus: "idle",
              hostReconnectGraceExpiresAt: null,
            },
          })),
        },
      ],
      personalProject: {
        id: "personal",
        name: "Personal",
        kind: "personal",
        gitRemoteUrl: null,
        sources: [],
        createdAt: 0,
        updatedAt: 0,
        threads: [],
      },
    },
  }),
}));
vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => vi.fn(),
}));

const {
  BoundSidebarThreadProjection,
  SidebarThreadProjectionBindingContext,
  resetSidebarProjectionDiagnosticsForTest,
} = await import("./SidebarThreadProjectionRenderer");

const invalidProjection: PluginSidebarThreadProjection = {
  regions: [],
  excludedThreadIds: [],
};
const excludedProjection: PluginSidebarThreadProjection = {
  regions: [],
  excludedThreadIds: ["thread-a", "thread-b"],
};
const nativeProjection: PluginSidebarThreadProjection = {
  regions: [
    {
      id: "manager",
      label: null,
      placement: "sticky",
      dividerAfter: true,
      collapsible: false,
      nesting: "flat",
      grouping: { kind: "none" },
      threadOrder: ["thread-a"],
    },
    {
      id: "independent",
      label: "Independent threads",
      placement: "flow",
      dividerAfter: false,
      collapsible: false,
      nesting: "flat",
      grouping: {
        kind: "project",
        projectOrder: ["project-a"],
        collapsible: true,
        showEmptyProjects: false,
      },
      threadOrder: ["thread-b"],
    },
  ],
  excludedThreadIds: [],
};

function Original() {
  return <p>Original sidebar</p>;
}

function renderProjection(
  projection: PluginSidebarThreadProjection,
  options: { generation?: number; isSearchActive?: boolean } = {},
) {
  return render(
    <TooltipProvider>
      <MemoryRouter>
        <SidebarThreadProjectionBindingContext.Provider
          value={{
            activeThreadId: null,
            generation: options.generation ?? 1,
            isSearchActive: options.isSearchActive ?? false,
            onNavigate: () => undefined,
            original: Original,
            pluginId: "test-plugin",
            registrationId: "test-list",
          }}
        >
          <BoundSidebarThreadProjection projection={projection} />
        </SidebarThreadProjectionBindingContext.Provider>
      </MemoryRouter>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  resetSidebarProjectionDiagnosticsForTest();
  toastError.mockClear();
  warn.mockClear();
});

afterEach(cleanup);

describe("BoundSidebarThreadProjection", () => {
  it.each(["", "find me"])(
    "bypasses projection validation during active search query %j",
    () => {
      renderProjection(invalidProjection, { isSearchActive: true });
      expect(screen.getByText("Original sidebar")).toBeDefined();
      expect(toastError).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it("falls back atomically, deduplicates diagnostics, and accepts a later projection", () => {
    const rendered = renderProjection(invalidProjection);
    expect(screen.getByText("Original sidebar")).toBeDefined();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <MemoryRouter>
        <SidebarThreadProjectionBindingContext.Provider
          value={{
            activeThreadId: null,
            generation: 1,
            isSearchActive: false,
            onNavigate: () => undefined,
            original: Original,
            pluginId: "test-plugin",
            registrationId: "test-list",
          }}
        >
          <BoundSidebarThreadProjection projection={invalidProjection} />
        </SidebarThreadProjectionBindingContext.Provider>
      </MemoryRouter>,
    );
    expect(toastError).toHaveBeenCalledTimes(1);

    rendered.rerender(
      <MemoryRouter>
        <SidebarThreadProjectionBindingContext.Provider
          value={{
            activeThreadId: null,
            generation: 1,
            isSearchActive: false,
            onNavigate: () => undefined,
            original: Original,
            pluginId: "test-plugin",
            registrationId: "test-list",
          }}
        >
          <BoundSidebarThreadProjection projection={excludedProjection} />
        </SidebarThreadProjectionBindingContext.Provider>
      </MemoryRouter>,
    );
    expect(screen.queryByText("Original sidebar")).toBeNull();
    expect(screen.getByText("No threads")).toBeDefined();
  });

  it("renders projected IDs through native project and thread modules", () => {
    const rendered = renderProjection(nativeProjection);
    expect(
      rendered.container.querySelector(
        '[data-sidebar-projection-region="manager"] [data-sidebar-thread-id="thread-a"]',
      ),
    ).not.toBeNull();
    expect(screen.getByTitle("Project A")).toBeDefined();
    const independent = rendered.container.querySelector(
      '[data-sidebar-projection-region="independent"] [data-sidebar-thread-id="thread-b"]',
    );
    expect(
      independent?.hasAttribute("data-sidebar-thread-shortcut-target"),
    ).toBe(true);
    expect(
      screen.getAllByRole("button", { name: "Thread actions" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", {
        name: "Open Manager (unsubmitted draft)",
      }),
    ).toBeDefined();
  });

  it("keeps the bound component type module-stable", () => {
    expect(BoundSidebarThreadProjection).toBe(BoundSidebarThreadProjection);
  });
});
