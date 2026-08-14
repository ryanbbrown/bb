// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectModeSections } from "./ProjectList";
import {
  sidebarProjectOrderAtom,
  sidebarSectionOrderAtom,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";

const mockUseSidebarSortable = vi.hoisted(() => vi.fn());
const mockProjectRows = vi.hoisted(() => new Map<string, boolean>());

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: vi.fn(() => ({ data: [] })),
  usePrimaryHost: vi.fn(() => null),
}));

vi.mock("@/hooks/queries/host-path-queries", () => ({
  isHostPathMissing: vi.fn(() => false),
  useHostPathExistence: vi.fn(() => ({})),
}));

vi.mock("./ProjectRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ProjectRow")>();
  return {
    ...actual,
    ProjectThreadTree: () => null,
  };
});

vi.mock("./ProjectListProjects", () => ({
  SortableProjectRow: (props: {
    project: ProjectResponse;
    reorderDisabled: boolean;
    sortableId: string;
  }) => {
    mockProjectRows.set(props.sortableId, props.reorderDisabled);
    return <div data-testid={props.sortableId}>{props.project.name}</div>;
  },
}));

vi.mock("./sortableMotion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sortableMotion")>();
  return {
    ...actual,
    useSidebarSortable: (args: { id: string; disabled: boolean }) => {
      mockUseSidebarSortable(args);
      return {
        dragBindings: {
          attributes: {},
          disabled: args.disabled,
          listeners: undefined,
          setActivatorNodeRef: vi.fn(),
        },
        isOver: false,
        setNodeRef: vi.fn(),
        style: {},
      };
    },
  };
});

function project(id: string, name: string): ProjectResponse {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    sources: [],
    createdAt: 0,
    updatedAt: 0,
  };
}

function thread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thr_default",
    projectId: "project_old",
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
    lastReadAt: 0,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
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
    ...overrides,
  };
}

function assertDocumentOrder(elements: HTMLElement[]) {
  for (let index = 1; index < elements.length; index += 1) {
    expect(
      elements[index - 1].compareDocumentPosition(elements[index]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  }
}

function renderProjectMode(store: ReturnType<typeof createStore>) {
  return render(
    <JotaiProvider store={store}>
      <ProjectModeSections
        projects={[
          project("project_old", "Old project"),
          project("project_new", "New project"),
        ]}
        threads={[
          thread({ id: "old", latestAttentionAt: 10 }),
          thread({
            id: "new",
            projectId: "project_new",
            latestAttentionAt: 20,
          }),
          thread({
            id: "personal",
            projectId: PERSONAL_PROJECT_ID,
            latestAttentionAt: 30,
          }),
        ]}
        draftThreadIds={new Set()}
        effectivePinnedThreadIds={new Set()}
        status="ready"
        isReady
        showPinnedSection
        pinnedSection={{ label: "Pinned", content: <div>Pinned content</div> }}
        threadsSection={{ label: "Threads" }}
        collapsedSectionIds={new Set()}
        collapsedThreadIds={new Set()}
        collapsedEnvironmentIds={new Set()}
        compareThreads={() => 0}
        renderSectionDisplayOptions={() => null}
        isSectionDisplayOptionsOpen={() => false}
        onCreateProjectThread={vi.fn()}
        onToggleCollapsed={vi.fn()}
        onToggleThreadCollapsed={vi.fn()}
        onToggleEnvironmentCollapsed={vi.fn()}
      />
    </JotaiProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockProjectRows.clear();
  window.localStorage.clear();
});

describe("ProjectModeSections project order", () => {
  it("renders recent activity order, disables reordering, and restores manual order", async () => {
    const store = createStore();
    const manualOrder: SidebarSectionId[] = [
      "project:project_old",
      "threads",
      "project:project_new",
      "pinned",
    ];
    store.set(sidebarSectionOrderAtom, manualOrder);
    store.set(sidebarProjectOrderAtom, "manual");

    renderProjectMode(store);

    assertDocumentOrder([
      screen.getByTestId("project:project_old"),
      screen.getByText("Threads"),
      screen.getByTestId("project:project_new"),
      screen.getByText("Pinned content"),
    ]);
    expect(mockUseSidebarSortable).toHaveBeenCalledWith({
      id: "pinned",
      disabled: false,
    });
    expect(mockUseSidebarSortable).toHaveBeenCalledWith({
      id: "threads",
      disabled: false,
    });
    expect(mockProjectRows.get("project:project_old")).toBe(false);
    expect(mockProjectRows.get("project:project_new")).toBe(false);

    act(() => store.set(sidebarProjectOrderAtom, "recent"));

    await waitFor(() => {
      assertDocumentOrder([
        screen.getByText("Pinned content"),
        screen.getByText("Threads"),
        screen.getByTestId("project:project_new"),
        screen.getByTestId("project:project_old"),
      ]);
    });
    expect(mockUseSidebarSortable).toHaveBeenCalledWith({
      id: "pinned",
      disabled: true,
    });
    expect(mockUseSidebarSortable).toHaveBeenCalledWith({
      id: "threads",
      disabled: true,
    });
    expect(mockProjectRows.get("project:project_old")).toBe(true);
    expect(mockProjectRows.get("project:project_new")).toBe(true);
    expect(store.get(sidebarSectionOrderAtom)).toEqual(manualOrder);

    mockUseSidebarSortable.mockClear();
    mockProjectRows.clear();
    act(() => store.set(sidebarProjectOrderAtom, "manual"));

    await waitFor(() => {
      assertDocumentOrder([
        screen.getByTestId("project:project_old"),
        screen.getByText("Threads"),
        screen.getByTestId("project:project_new"),
        screen.getByText("Pinned content"),
      ]);
    });
    expect(mockUseSidebarSortable).toHaveBeenCalledWith({
      id: "pinned",
      disabled: false,
    });
    expect(mockUseSidebarSortable).toHaveBeenCalledWith({
      id: "threads",
      disabled: false,
    });
    expect(mockProjectRows.get("project:project_old")).toBe(false);
    expect(mockProjectRows.get("project:project_new")).toBe(false);
    expect(store.get(sidebarSectionOrderAtom)).toEqual(manualOrder);
  });
});
