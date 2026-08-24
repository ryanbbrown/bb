import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import {
  SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH,
  SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES,
  SIDEBAR_PROJECTION_MAX_REGIONS,
  SIDEBAR_PROJECTION_MAX_TEXT_LENGTH,
  SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES,
  validateSidebarThreadProjection,
} from "./sidebarThreadProjection";

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
    runtime: { displayStatus: "idle", hostReconnectGraceExpiresAt: null },
    ...overrides,
  };
}

function makeRegion(overrides: Record<string, unknown> = {}) {
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

function validate(
  projection: unknown,
  threads: readonly ThreadListEntry[] = [],
  projects: readonly { id: string }[] = [{ id: "proj_a" }, { id: "proj_b" }],
) {
  return validateSidebarThreadProjection({ projection, threads, projects });
}

function expectInvalid(result: ReturnType<typeof validate>, reason: string) {
  expect(result.kind).toBe("invalid");
  if (result.kind !== "invalid") return;
  expect(result.reason).toBe(reason);
  expect(result.diagnostic.length).toBeLessThanOrEqual(
    SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH,
  );
}

describe("validateSidebarThreadProjection", () => {
  it("accepts a complete projection and canonicalizes its regions", () => {
    const threads = [
      makeThread({ id: "thr_a" }),
      makeThread({ id: "thr_b" }),
      makeThread({ id: "thr_c" }),
    ];
    const result = validate(
      {
        regions: [
          makeRegion({ id: "pinned", threadOrder: ["thr_b", "thr_a"] }),
        ],
        excludedThreadIds: ["thr_c"],
      },
      threads,
    );

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.projection.regions).toHaveLength(1);
    expect(result.projection.regions[0]?.threadOrder).toEqual([
      "thr_b",
      "thr_a",
    ]);
    expect(result.projection.regions[0]?.projectGroups).toEqual([]);
    expect(result.projection.excludedThreadIds).toEqual(["thr_c"]);
  });

  it("rejects a duplicate thread inside one region", () => {
    expectInvalid(
      validate(
        {
          regions: [makeRegion({ threadOrder: ["thr_a", "thr_a"] })],
          excludedThreadIds: [],
        },
        [makeThread({ id: "thr_a" })],
      ),
      "duplicate-thread",
    );
  });

  it("rejects the same thread placed in two regions", () => {
    expectInvalid(
      validate(
        {
          regions: [
            makeRegion({ id: "one", threadOrder: ["thr_a"] }),
            makeRegion({ id: "two", threadOrder: ["thr_a"] }),
          ],
          excludedThreadIds: [],
        },
        [makeThread({ id: "thr_a" })],
      ),
      "duplicate-thread",
    );
  });

  it("rejects an unknown thread id", () => {
    expectInvalid(
      validate({
        regions: [makeRegion({ threadOrder: ["thr_missing"] })],
        excludedThreadIds: [],
      }),
      "unknown-thread",
    );
  });

  it("rejects a hidden thread placed in a region", () => {
    expectInvalid(
      validate(
        {
          regions: [makeRegion({ threadOrder: ["thr_hidden"] })],
          excludedThreadIds: [],
        },
        [makeThread({ id: "thr_hidden", visibility: "hidden" })],
      ),
      "ineligible-thread",
    );
  });

  it("does not require a hidden thread to be placed or excluded", () => {
    const result = validate(
      {
        regions: [makeRegion({ threadOrder: ["thr_a"] })],
        excludedThreadIds: [],
      },
      [
        makeThread({ id: "thr_a" }),
        makeThread({ id: "thr_hidden", visibility: "hidden" }),
      ],
    );

    expect(result.kind).toBe("valid");
  });

  it("rejects an archived thread placed in a region", () => {
    expectInvalid(
      validate(
        {
          regions: [makeRegion({ threadOrder: ["thr_old"] })],
          excludedThreadIds: [],
        },
        [makeThread({ id: "thr_old", archivedAt: 5 })],
      ),
      "ineligible-thread",
    );
  });

  it("rejects an eligible thread that is neither placed nor excluded", () => {
    expectInvalid(
      validate(
        {
          regions: [makeRegion({ threadOrder: ["thr_a"] })],
          excludedThreadIds: [],
        },
        [makeThread({ id: "thr_a" }), makeThread({ id: "thr_b" })],
      ),
      "uncovered-thread",
    );
  });

  it("rejects a thread that is both placed and excluded", () => {
    expectInvalid(
      validate(
        {
          regions: [makeRegion({ threadOrder: ["thr_a"] })],
          excludedThreadIds: ["thr_a"],
        },
        [makeThread({ id: "thr_a" })],
      ),
      "visible-exclusion",
    );
  });

  it("rejects a repeated exclusion and an unknown exclusion", () => {
    expectInvalid(
      validate({ regions: [], excludedThreadIds: ["thr_a", "thr_a"] }, [
        makeThread({ id: "thr_a" }),
      ]),
      "duplicate-exclusion",
    );
    expectInvalid(
      validate({ regions: [], excludedThreadIds: ["thr_missing"] }),
      "unknown-exclusion",
    );
  });

  it("rejects a duplicate region id", () => {
    expectInvalid(
      validate({
        regions: [makeRegion({ id: "same" }), makeRegion({ id: "same" })],
        excludedThreadIds: [],
      }),
      "duplicate-region",
    );
  });

  it("rejects a sticky region that follows a flow region", () => {
    expectInvalid(
      validate({
        regions: [
          makeRegion({ id: "one", placement: "flow" }),
          makeRegion({ id: "two", placement: "sticky" }),
        ],
        excludedThreadIds: [],
      }),
      "sticky-order",
    );
  });

  it("rejects a collapsible region with no label", () => {
    expectInvalid(
      validate({
        regions: [makeRegion({ label: null, collapsible: true })],
        excludedThreadIds: [],
      }),
      "headerless-collapse",
    );
  });

  it.each([
    ["placement", { placement: "floating" }],
    ["nesting", { nesting: "tree" }],
    ["grouping.kind", { grouping: { kind: "folder" } }],
  ])("rejects a malformed %s value", (_name, overrides) => {
    expectInvalid(
      validate({
        regions: [makeRegion(overrides)],
        excludedThreadIds: [],
      }),
      "invalid-discriminant",
    );
  });

  it.each([
    ["dividerAfter", { dividerAfter: "yes" }],
    ["collapsible", { collapsible: 1 }],
    ["threadOrder", { threadOrder: "thr_a" }],
    ["grouping", { grouping: null }],
  ])("rejects a malformed %s shape", (_name, overrides) => {
    expectInvalid(
      validate({
        regions: [makeRegion(overrides)],
        excludedThreadIds: [],
      }),
      "invalid-shape",
    );
  });

  it("rejects a blank region id and a blank label", () => {
    expectInvalid(
      validate({ regions: [makeRegion({ id: "  " })], excludedThreadIds: [] }),
      "blank-value",
    );
    expectInvalid(
      validate({ regions: [makeRegion({ label: "" })], excludedThreadIds: [] }),
      "blank-value",
    );
  });

  it("groups a project region by projectOrder and drops empty projects", () => {
    const threads = [
      makeThread({ id: "thr_a", projectId: "proj_a" }),
      makeThread({ id: "thr_b", projectId: "proj_b" }),
    ];
    const result = validate(
      {
        regions: [
          makeRegion({
            threadOrder: ["thr_a", "thr_b"],
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
      threads,
      [{ id: "proj_a" }, { id: "proj_b" }, { id: "proj_c" }],
    );

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.projection.regions[0]?.projectGroups).toEqual([
      { projectId: "proj_b", threadIds: ["thr_b"] },
      { projectId: "proj_a", threadIds: ["thr_a"] },
    ]);
  });

  it("keeps a listed empty project when showEmptyProjects is set", () => {
    const result = validate(
      {
        regions: [
          makeRegion({
            threadOrder: ["thr_a"],
            grouping: {
              kind: "project",
              projectOrder: ["proj_a", "proj_b"],
              collapsible: false,
              showEmptyProjects: true,
            },
          }),
        ],
        excludedThreadIds: [],
      },
      [makeThread({ id: "thr_a", projectId: "proj_a" })],
    );

    expect(result.kind).toBe("valid");
    if (result.kind !== "valid") return;
    expect(result.projection.regions[0]?.projectGroups).toEqual([
      { projectId: "proj_a", threadIds: ["thr_a"] },
      { projectId: "proj_b", threadIds: [] },
    ]);
  });

  it("routes a nested child to the project of the root it renders under", () => {
    const threads = [
      makeThread({ id: "thr_parent", projectId: "proj_a" }),
      makeThread({
        id: "thr_child",
        projectId: "proj_b",
        parentThreadId: "thr_parent",
      }),
    ];
    const projection = (nesting: string) => ({
      regions: [
        makeRegion({
          nesting,
          threadOrder: ["thr_parent", "thr_child"],
          grouping: {
            kind: "project",
            projectOrder: ["proj_a", "proj_b"],
            collapsible: false,
            showEmptyProjects: false,
          },
        }),
      ],
      excludedThreadIds: [],
    });

    const nativeResult = validate(projection("native"), threads);
    expect(nativeResult.kind).toBe("valid");
    if (nativeResult.kind !== "valid") return;
    expect(nativeResult.projection.regions[0]?.projectGroups).toEqual([
      { projectId: "proj_a", threadIds: ["thr_parent", "thr_child"] },
    ]);

    const flatResult = validate(projection("flat"), threads);
    expect(flatResult.kind).toBe("valid");
    if (flatResult.kind !== "valid") return;
    expect(flatResult.projection.regions[0]?.projectGroups).toEqual([
      { projectId: "proj_a", threadIds: ["thr_parent"] },
      { projectId: "proj_b", threadIds: ["thr_child"] },
    ]);
  });

  it("rejects a project the region represents but projectOrder omits", () => {
    expectInvalid(
      validate(
        {
          regions: [
            makeRegion({
              threadOrder: ["thr_a", "thr_b"],
              grouping: {
                kind: "project",
                projectOrder: ["proj_a"],
                collapsible: false,
                showEmptyProjects: false,
              },
            }),
          ],
          excludedThreadIds: [],
        },
        [
          makeThread({ id: "thr_a", projectId: "proj_a" }),
          makeThread({ id: "thr_b", projectId: "proj_b" }),
        ],
      ),
      "missing-project-order",
    );
  });

  it("rejects an unknown and a repeated project id", () => {
    const grouping = (projectOrder: string[]) => ({
      kind: "project",
      projectOrder,
      collapsible: false,
      showEmptyProjects: false,
    });
    expectInvalid(
      validate({
        regions: [makeRegion({ grouping: grouping(["proj_missing"]) })],
        excludedThreadIds: [],
      }),
      "unknown-project",
    );
    expectInvalid(
      validate({
        regions: [makeRegion({ grouping: grouping(["proj_a", "proj_a"]) })],
        excludedThreadIds: [],
      }),
      "duplicate-project",
    );
  });

  it("enforces the region, thread, project, and text limits", () => {
    expectInvalid(
      validate({
        regions: Array.from(
          { length: SIDEBAR_PROJECTION_MAX_REGIONS + 1 },
          (_value, index) => makeRegion({ id: `region-${index}` }),
        ),
        excludedThreadIds: [],
      }),
      "region-limit",
    );

    expectInvalid(
      validate({
        regions: [],
        excludedThreadIds: Array.from(
          { length: SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES + 1 },
          (_value, index) => `thr_${index}`,
        ),
      }),
      "thread-limit",
    );

    expectInvalid(
      validate({
        regions: [
          makeRegion({
            grouping: {
              kind: "project",
              projectOrder: Array.from(
                { length: SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES + 1 },
                (_value, index) => `proj_${index}`,
              ),
              collapsible: false,
              showEmptyProjects: false,
            },
          }),
        ],
        excludedThreadIds: [],
      }),
      "project-limit",
    );

    expectInvalid(
      validate({
        regions: [
          makeRegion({
            label: "x".repeat(SIDEBAR_PROJECTION_MAX_TEXT_LENGTH + 1),
          }),
        ],
        excludedThreadIds: [],
      }),
      "text-limit",
    );
  });

  it("spends the thread-reference budget across exclusions and regions", () => {
    const half = Math.floor(SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES / 2) + 1;
    expectInvalid(
      validate({
        regions: [
          makeRegion({
            threadOrder: Array.from(
              { length: half },
              (_value, index) => `thr_region_${index}`,
            ),
          }),
        ],
        excludedThreadIds: Array.from(
          { length: half },
          (_value, index) => `thr_excluded_${index}`,
        ),
      }),
      "thread-limit",
    );
  });

  it("truncates a long diagnostic", () => {
    const longId = "t".repeat(SIDEBAR_PROJECTION_MAX_TEXT_LENGTH);
    const result = validate({
      regions: [
        makeRegion({
          id: "r".repeat(SIDEBAR_PROJECTION_MAX_TEXT_LENGTH),
          threadOrder: [longId],
        }),
      ],
      excludedThreadIds: [],
    });

    expect(result.kind).toBe("invalid");
    if (result.kind !== "invalid") return;
    expect(result.diagnostic).toHaveLength(
      SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH,
    );
  });

  it.each([
    ["a non-object projection", null],
    ["a projection with no regions array", { excludedThreadIds: [] }],
    ["a projection with no exclusion array", { regions: [] }],
  ])("rejects %s", (_name, projection) => {
    expectInvalid(validate(projection), "invalid-shape");
  });
});
