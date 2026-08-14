import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { getProjectModeSectionOrder } from "./projectActivityOrder";
import type { SidebarSectionId } from "./sidebarCollapsedAtoms";

function thread(overrides: Partial<ThreadListEntry> = {}): ThreadListEntry {
  return {
    id: "thr_default",
    projectId: "project_a",
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

function recentOrder({
  effectivePinnedThreadIds = new Set<string>(),
  groups,
  manualOrder = groups.map(({ id }) => id),
  showPinnedSection = false,
}: {
  effectivePinnedThreadIds?: ReadonlySet<string>;
  groups: { id: SidebarSectionId; threads: ThreadListEntry[] }[];
  manualOrder?: SidebarSectionId[];
  showPinnedSection?: boolean;
}) {
  return getProjectModeSectionOrder({
    effectivePinnedThreadIds,
    groups,
    manualOrder,
    orderMode: "recent",
    showPinnedSection,
  });
}

describe("project activity order", () => {
  it("moves the project with newer idle attention first", () => {
    expect(
      recentOrder({
        groups: [
          {
            id: "project:older",
            threads: [thread({ id: "older", latestAttentionAt: 10 })],
          },
          {
            id: "project:newer",
            threads: [thread({ id: "newer", latestAttentionAt: 20 })],
          },
        ],
      }),
    ).toEqual(["project:newer", "project:older"]);
  });

  it("moves an active project before an idle project", () => {
    expect(
      recentOrder({
        groups: [
          {
            id: "project:idle",
            threads: [thread({ id: "idle", latestAttentionAt: 100 })],
          },
          {
            id: "project:active",
            threads: [thread({ id: "active", status: "active" })],
          },
        ],
      }),
    ).toEqual(["project:active", "project:idle"]);
  });

  it("orders active projects by their newest active thread creation time", () => {
    expect(
      recentOrder({
        groups: [
          {
            id: "project:older",
            threads: [thread({ id: "older", status: "active", createdAt: 10 })],
          },
          {
            id: "project:newer",
            threads: [
              thread({ id: "newer_1", status: "active", createdAt: 20 }),
              thread({ id: "newer_2", status: "active", createdAt: 30 }),
            ],
          },
        ],
      }),
    ).toEqual(["project:newer", "project:older"]);
  });

  it("uses attention activity instead of alphabetical or created row order", () => {
    expect(
      recentOrder({
        groups: [
          {
            id: "project:activity",
            threads: [
              thread({
                id: "activity",
                title: "Zulu",
                createdAt: 1,
                latestAttentionAt: 30,
              }),
            ],
          },
          {
            id: "project:row-sort",
            threads: [
              thread({
                id: "row_sort",
                title: "Alpha",
                createdAt: 50,
                latestAttentionAt: 2,
              }),
            ],
          },
        ],
      }),
    ).toEqual(["project:activity", "project:row-sort"]);
  });

  it("sorts the projectless Threads group among projects", () => {
    expect(
      recentOrder({
        groups: [
          {
            id: "project:a",
            threads: [thread({ id: "project", latestAttentionAt: 10 })],
          },
          {
            id: "threads",
            threads: [
              thread({
                id: "personal",
                projectId: PERSONAL_PROJECT_ID,
                latestAttentionAt: 20,
              }),
            ],
          },
        ],
      }),
    ).toEqual(["threads", "project:a"]);
  });

  it("ignores hidden and effective pinned descendants", () => {
    expect(
      recentOrder({
        effectivePinnedThreadIds: new Set(["pinned_child"]),
        groups: [
          {
            id: "project:excluded",
            threads: [
              thread({
                id: "hidden_child",
                parentThreadId: "root",
                visibility: "hidden",
                latestAttentionAt: 100,
              }),
              thread({
                id: "pinned_child",
                parentThreadId: "root",
                pinnedAt: null,
                latestAttentionAt: 90,
              }),
            ],
          },
          {
            id: "project:eligible",
            threads: [thread({ id: "eligible", latestAttentionAt: 20 })],
          },
        ],
      }),
    ).toEqual(["project:eligible", "project:excluded"]);
  });

  it("lets an eligible nested child move its project", () => {
    expect(
      recentOrder({
        groups: [
          {
            id: "project:nested",
            threads: [
              thread({ id: "root", latestAttentionAt: 1 }),
              thread({
                id: "child",
                parentThreadId: "root",
                latestAttentionAt: 40,
              }),
            ],
          },
          {
            id: "project:other",
            threads: [thread({ id: "other", latestAttentionAt: 20 })],
          },
        ],
      }),
    ).toEqual(["project:nested", "project:other"]);
  });

  it("puts empty groups last in manual order and unknown groups last deterministically", () => {
    expect(
      recentOrder({
        groups: [
          { id: "project:unknown-b", threads: [] },
          { id: "project:empty-a", threads: [] },
          {
            id: "project:active",
            threads: [thread({ id: "eligible", latestAttentionAt: 1 })],
          },
          { id: "project:unknown-a", threads: [] },
          { id: "project:empty-b", threads: [] },
        ],
        manualOrder: ["project:empty-b", "project:active", "project:empty-a"],
      }),
    ).toEqual([
      "project:active",
      "project:empty-b",
      "project:empty-a",
      "project:unknown-a",
      "project:unknown-b",
    ]);
  });

  it("keeps Pinned first only when its section is visible", () => {
    const groups = [{ id: "threads" as const, threads: [] }];

    expect(recentOrder({ groups, showPinnedSection: true })).toEqual([
      "pinned",
      "threads",
    ]);
    expect(recentOrder({ groups, showPinnedSection: false })).toEqual([
      "threads",
    ]);
  });

  it("returns normalized manual order unchanged in manual mode", () => {
    const manualOrder: SidebarSectionId[] = [
      "threads",
      "project:b",
      "pinned",
      "project:a",
    ];

    expect(
      getProjectModeSectionOrder({
        effectivePinnedThreadIds: new Set(),
        groups: [],
        manualOrder,
        orderMode: "manual",
        showPinnedSection: true,
      }),
    ).toEqual(manualOrder);
  });
});
