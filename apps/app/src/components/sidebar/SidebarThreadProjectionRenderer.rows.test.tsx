// @vitest-environment jsdom

// Row behavior under a projection, against the REAL ThreadActionsProvider and
// the real context menu. Only the network (`@/lib/sdk`) and the sidebar
// bootstrap query are stubbed, so a change to BB's own menu, rename flow, or
// delete confirmation shows up here.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { createStore, Provider as JotaiProvider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type {
  ProjectWithThreadsResponse,
  SidebarBootstrapResponse,
} from "@bb/server-contract";
import type { experimental_PluginSidebarThreadProjection } from "@get-bb/plugin-sdk";
import { TooltipProvider } from "@bb/shared-ui/tooltip";

const mocks = vi.hoisted(() => ({
  archiveAll: vi.fn(async () => ({ archivedThreadIds: ["thr_a1"] })),
  childSummary: vi.fn(async () => ({ childThreadCount: 0 })),
  navigation: { data: undefined as SidebarBootstrapResponse | undefined },
  updateThread: vi.fn(async () => ({})),
}));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    threads: {
      archiveAll: mocks.archiveAll,
      childSummary: mocks.childSummary,
      update: mocks.updateThread,
    },
  },
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/hooks/queries/sidebar-navigation-query")
  >()),
  useSidebarNavigation: () => mocks.navigation,
}));

import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import {
  BoundSidebarThreadProjection,
  resetSidebarProjectionDiagnosticsForTest,
  SidebarThreadProjectionBindingProvider,
} from "./SidebarThreadProjectionRenderer";

function makeThread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_a1",
    projectId: "proj_a",
    environmentId: null,
    providerId: "codex",
    title: "Alpha one",
    titleFallback: "Alpha one",
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

const PROJECTION: experimental_PluginSidebarThreadProjection = {
  regions: [
    {
      id: "region-a",
      label: "Region A",
      placement: "sticky",
      dividerAfter: false,
      collapsible: false,
      nesting: "native",
      grouping: { kind: "none" },
      threadOrder: ["thr_a1"],
    },
  ],
  excludedThreadIds: [],
};

function renderProjectedRow() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={createStore()}>
        <TooltipProvider>
          <MemoryRouter>
            <ThreadActionsProvider>
              <SidebarThreadProjectionBindingProvider
                activeThreadId={null}
                generation={1}
                isSearchFieldOpen={false}
                onNavigate={() => {}}
                Original={() => <div data-testid="original-list" />}
                pluginId="firstmate"
                registrationId="sidebar"
              >
                <BoundSidebarThreadProjection projection={PROJECTION} />
              </SidebarThreadProjectionBindingProvider>
            </ThreadActionsProvider>
          </MemoryRouter>
        </TooltipProvider>
      </JotaiProvider>
    </QueryClientProvider>,
  );
}

describe("projected rows against the real thread actions", () => {
  beforeEach(() => {
    mocks.navigation.data = {
      sections: [],
      projects: [makeProject("proj_a", "Alpha", [makeThread()])],
      personalProject: makeProject("proj_personal", "Personal", []),
    };
  });

  afterEach(() => {
    cleanup();
    resetSidebarProjectionDiagnosticsForTest();
    vi.clearAllMocks();
  });

  it("opens BB's own context menu on a projected row", () => {
    renderProjectedRow();

    fireEvent.contextMenu(screen.getByRole("link", { name: "Open Alpha one" }));

    for (const label of ["Rename", "Archive", "Delete"]) {
      expect(screen.getByRole("menuitem", { name: label })).not.toBeNull();
    }
  });

  it("renames a projected row inline through the real action", async () => {
    renderProjectedRow();

    fireEvent.doubleClick(screen.getByText("Alpha one"));
    const input = screen.getByRole("textbox", { name: "Thread name" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mocks.updateThread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: "thr_a1", title: "Renamed" }),
      );
    });
  });

  it("archives a projected row through the real mutation", async () => {
    renderProjectedRow();

    fireEvent.contextMenu(screen.getByRole("link", { name: "Open Alpha one" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));

    await waitFor(() => {
      expect(mocks.archiveAll).toHaveBeenCalledWith({ threadId: "thr_a1" });
    });
  });

  it("opens BB's delete confirmation from a projected row", async () => {
    renderProjectedRow();

    fireEvent.contextMenu(screen.getByRole("link", { name: "Open Alpha one" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByText("Delete thread?")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Delete thread" }),
    ).not.toBeNull();
  });
});
