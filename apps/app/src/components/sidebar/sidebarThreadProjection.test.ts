import { describe, expect, it } from "vitest";
import type { PluginSidebarThreadProjection } from "@get-bb/plugin-sdk";
import {
  SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH,
  SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES,
  SIDEBAR_PROJECTION_MAX_REGIONS,
  SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES,
  buildSidebarProjectionCollapseKey,
  validateSidebarThreadProjection,
  type SidebarProjectionThreadSnapshot,
} from "./sidebarThreadProjection";

function thread(
  id: string,
  overrides: Partial<SidebarProjectionThreadSnapshot> = {},
): SidebarProjectionThreadSnapshot {
  return {
    id,
    projectId: "project-a",
    parentThreadId: null,
    archivedAt: null,
    deletedAt: null,
    visibility: "visible",
    ...overrides,
  };
}

const projects = [{ id: "project-a" }, { id: "project-b" }];

function region(
  overrides: Partial<PluginSidebarThreadProjection["regions"][number]> = {},
): PluginSidebarThreadProjection["regions"][number] {
  return {
    id: "main",
    label: "Main",
    placement: "flow",
    dividerAfter: false,
    collapsible: false,
    nesting: "flat",
    grouping: { kind: "none" },
    threadOrder: ["one", "two"],
    ...overrides,
  };
}

function validate(
  projection: unknown,
  threads: SidebarProjectionThreadSnapshot[] = [thread("one"), thread("two")],
) {
  return validateSidebarThreadProjection({ projection, threads, projects });
}

describe("validateSidebarThreadProjection", () => {
  it("accepts exact coverage split between ordered regions and exclusions", () => {
    const result = validate({
      regions: [region({ threadOrder: ["two"] })],
      excludedThreadIds: ["one"],
    });
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.projection.regions[0]!.threadOrder).toEqual(["two"]);
      expect(result.projection.excludedThreadIds).toEqual(["one"]);
    }
  });

  it("groups flat threads by their own project in project order", () => {
    const result = validate(
      {
        regions: [
          region({
            grouping: {
              kind: "project",
              projectOrder: ["project-b", "project-a"],
              collapsible: true,
              showEmptyProjects: false,
            },
            threadOrder: ["one", "two"],
          }),
        ],
        excludedThreadIds: [],
      },
      [thread("one"), thread("two", { projectId: "project-b" })],
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.projection.regions[0]!.projectGroups).toEqual([
        { projectId: "project-b", threadIds: ["two"] },
        { projectId: "project-a", threadIds: ["one"] },
      ]);
    }
  });

  it("keeps a native cross-project child under its represented parent project", () => {
    const result = validate(
      {
        regions: [
          region({
            nesting: "native",
            grouping: {
              kind: "project",
              projectOrder: ["project-a"],
              collapsible: false,
              showEmptyProjects: false,
            },
          }),
        ],
        excludedThreadIds: [],
      },
      [
        thread("one"),
        thread("two", {
          projectId: "project-b",
          parentThreadId: "one",
        }),
      ],
    );
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.projection.regions[0]!.projectGroups).toEqual([
        { projectId: "project-a", threadIds: ["one", "two"] },
      ]);
    }
  });

  it.each([
    [
      "parent chain",
      [
        thread("one"),
        thread("two", { parentThreadId: "one", projectId: "project-b" }),
      ],
      ["project-a"],
    ],
    [
      "missing parent",
      [
        thread("one", {
          parentThreadId: "missing",
          projectId: "project-b",
        }),
        thread("two"),
      ],
      ["project-a", "project-b"],
    ],
    [
      "cycle",
      [
        thread("one", { parentThreadId: "two", projectId: "project-a" }),
        thread("two", { parentThreadId: "one", projectId: "project-b" }),
      ],
      ["project-b"],
    ],
  ] as const)(
    "matches the shared native project resolver for %s",
    (_name, nativeThreads, representedProjects) => {
      const result = validate(
        {
          regions: [
            region({
              nesting: "native",
              grouping: {
                kind: "project",
                projectOrder: ["project-a", "project-b"],
                collapsible: false,
                showEmptyProjects: false,
              },
            }),
          ],
          excludedThreadIds: [],
        },
        [...nativeThreads],
      );
      expect(result.kind).toBe("valid");
      if (result.kind === "valid") {
        expect(
          result.projection.regions[0]!.projectGroups.map(
            ({ projectId }) => projectId,
          ),
        ).toEqual(representedProjects);
      }
    },
  );

  it("includes ordered empty projects only when requested", () => {
    const result = validate({
      regions: [
        region({
          threadOrder: ["one", "two"],
          grouping: {
            kind: "project",
            projectOrder: ["project-a", "project-b"],
            collapsible: false,
            showEmptyProjects: true,
          },
        }),
      ],
      excludedThreadIds: [],
    });
    expect(result.kind).toBe("valid");
    if (result.kind === "valid") {
      expect(result.projection.regions[0]!.projectGroups[1]).toEqual({
        projectId: "project-b",
        threadIds: [],
      });
    }
  });

  it.each([
    [
      "duplicate thread",
      {
        regions: [region({ threadOrder: ["one", "one", "two"] })],
        excludedThreadIds: [],
      },
      "duplicate-thread",
    ],
    [
      "unknown thread",
      {
        regions: [region({ threadOrder: ["one", "stale"] })],
        excludedThreadIds: ["two"],
      },
      "unknown-thread",
    ],
    [
      "archived thread",
      { regions: [region()], excludedThreadIds: [] },
      "archived-thread",
    ],
    [
      "hidden thread",
      { regions: [region()], excludedThreadIds: [] },
      "hidden-thread",
    ],
    [
      "deleted thread",
      { regions: [region()], excludedThreadIds: [] },
      "deleted-thread",
    ],
    [
      "missing thread",
      { regions: [region({ threadOrder: ["one"] })], excludedThreadIds: [] },
      "missing-thread",
    ],
    [
      "visible exclusion",
      { regions: [region()], excludedThreadIds: ["one"] },
      "visible-exclusion",
    ],
  ] as const)("atomically rejects a %s", (_name, projection, reason) => {
    const threads =
      reason === "archived-thread"
        ? [thread("one", { archivedAt: 1 }), thread("two")]
        : reason === "hidden-thread"
          ? [thread("one", { visibility: "hidden" }), thread("two")]
          : reason === "deleted-thread"
            ? [thread("one", { deletedAt: 1 }), thread("two")]
            : undefined;
    const result = validate(projection, threads);
    expect(result).toMatchObject({ kind: "invalid", reason });
    expect("projection" in result).toBe(false);
  });

  it("rejects a collapsible region without a heading", () => {
    const result = validate({
      regions: [region({ label: null, collapsible: true })],
      excludedThreadIds: [],
    });
    expect(result).toMatchObject({
      kind: "invalid",
      reason: "headerless-collapse",
    });
  });

  it("rejects sticky regions after flow regions", () => {
    const result = validate({
      regions: [
        region({ id: "flow", threadOrder: ["one"] }),
        region({ id: "sticky", placement: "sticky", threadOrder: ["two"] }),
      ],
      excludedThreadIds: [],
    });
    expect(result).toMatchObject({ kind: "invalid", reason: "sticky-order" });
  });

  it.each([
    ["duplicate project", ["project-a", "project-a"], "duplicate-project"],
    ["unknown project", ["missing"], "unknown-project"],
    ["represented project omitted", ["project-b"], "missing-project-order"],
  ] as const)("rejects %s in projectOrder", (_name, projectOrder, reason) => {
    const result = validate({
      regions: [
        region({
          grouping: {
            kind: "project",
            projectOrder,
            collapsible: false,
            showEmptyProjects: false,
          },
        }),
      ],
      excludedThreadIds: [],
    });
    expect(result).toMatchObject({ kind: "invalid", reason });
  });

  it("enforces exclusion limits before parsing with zero regions", () => {
    const exactThreads = Array.from(
      { length: SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES },
      (_, index) => thread(`excluded-${index}`),
    );
    expect(
      validateSidebarThreadProjection({
        projection: {
          regions: [],
          excludedThreadIds: exactThreads.map(({ id }) => id),
        },
        threads: exactThreads,
        projects,
      }).kind,
    ).toBe("valid");
    expect(
      validate({
        regions: [],
        excludedThreadIds: Array.from(
          { length: SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES + 1 },
          (_, index) => `too-many-${index}`,
        ),
      }),
    ).toMatchObject({ kind: "invalid", reason: "thread-limit" });
  });

  it("enforces thread-order and combined thread-reference boundaries", () => {
    const exactThreads = Array.from(
      { length: SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES },
      (_, index) => thread(`visible-${index}`),
    );
    expect(
      validateSidebarThreadProjection({
        projection: {
          regions: [region({ threadOrder: exactThreads.map(({ id }) => id) })],
          excludedThreadIds: [],
        },
        threads: exactThreads,
        projects,
      }).kind,
    ).toBe("valid");
    expect(
      validate({
        regions: [
          region({
            threadOrder: Array.from(
              { length: SIDEBAR_PROJECTION_MAX_THREAD_REFERENCES + 1 },
              (_, index) => `too-many-${index}`,
            ),
          }),
        ],
        excludedThreadIds: [],
      }),
    ).toMatchObject({ kind: "invalid", reason: "thread-limit" });

    const excluded = exactThreads.slice(0, 25_000);
    const visible = exactThreads.slice(25_000);
    expect(
      validateSidebarThreadProjection({
        projection: {
          regions: [region({ threadOrder: visible.map(({ id }) => id) })],
          excludedThreadIds: excluded.map(({ id }) => id),
        },
        threads: exactThreads,
        projects,
      }).kind,
    ).toBe("valid");
    expect(
      validate({
        regions: [
          region({
            threadOrder: Array.from({ length: 25_001 }, (_, index) =>
              index < 2 ? ["one", "two"][index]! : `visible-${index}`,
            ),
          }),
        ],
        excludedThreadIds: Array.from(
          { length: 25_000 },
          (_, index) => `excluded-${index}`,
        ),
      }),
    ).toMatchObject({ kind: "invalid", reason: "thread-limit" });
  });

  it("enforces project-order and combined project-reference boundaries", () => {
    const manyProjects = Array.from(
      { length: SIDEBAR_PROJECTION_MAX_PROJECT_REFERENCES },
      (_, index) => ({ id: `project-${index}` }),
    );
    const grouping = {
      kind: "project" as const,
      projectOrder: manyProjects.map(({ id }) => id),
      collapsible: false,
      showEmptyProjects: true,
    };
    expect(
      validateSidebarThreadProjection({
        projection: {
          regions: [region({ threadOrder: [], grouping })],
          excludedThreadIds: [],
        },
        threads: [],
        projects: manyProjects,
      }).kind,
    ).toBe("valid");
    expect(
      validateSidebarThreadProjection({
        projection: {
          regions: [
            region({
              threadOrder: [],
              grouping: {
                ...grouping,
                projectOrder: [...grouping.projectOrder, "overflow"],
              },
            }),
          ],
          excludedThreadIds: [],
        },
        threads: [],
        projects: [...manyProjects, { id: "overflow" }],
      }),
    ).toMatchObject({ kind: "invalid", reason: "project-limit" });
    const combinedProjection = (secondEnd: number) => ({
      regions: [
        region({
          id: "first",
          threadOrder: [],
          grouping: {
            ...grouping,
            projectOrder: grouping.projectOrder.slice(0, 5_000),
          },
        }),
        region({
          id: "second",
          threadOrder: [],
          grouping: {
            ...grouping,
            projectOrder: grouping.projectOrder.slice(5_000, secondEnd),
          },
        }),
      ],
      excludedThreadIds: [],
    });
    expect(
      validateSidebarThreadProjection({
        projection: combinedProjection(10_000),
        threads: [],
        projects: manyProjects,
      }).kind,
    ).toBe("valid");
    expect(
      validateSidebarThreadProjection({
        projection: {
          ...combinedProjection(10_000),
          regions: [
            ...combinedProjection(10_000).regions,
            region({
              id: "overflow",
              threadOrder: [],
              grouping: {
                ...grouping,
                projectOrder: [grouping.projectOrder[0]!],
              },
            }),
          ],
        },
        threads: [],
        projects: manyProjects,
      }),
    ).toMatchObject({ kind: "invalid", reason: "project-limit" });
  });

  it("bounds regions and diagnostics", () => {
    const result = validate({
      regions: Array.from(
        { length: SIDEBAR_PROJECTION_MAX_REGIONS + 1 },
        (_, index) => region({ id: `region-${index}`, threadOrder: [] }),
      ),
      excludedThreadIds: ["one", "two"],
    });
    expect(result).toMatchObject({ kind: "invalid", reason: "region-limit" });
    if (result.kind === "invalid") {
      expect(result.diagnostic.length).toBeLessThanOrEqual(
        SIDEBAR_PROJECTION_MAX_DIAGNOSTIC_LENGTH,
      );
    }
  });

  it("turns a throwing runtime shape into one bounded invalid result", () => {
    const projection = {} as Record<string, unknown>;
    Object.defineProperty(projection, "regions", {
      get() {
        throw new Error("broken getter");
      },
    });
    const result = validate(projection);
    expect(result).toMatchObject({ kind: "invalid", reason: "invalid-shape" });
  });

  it("validates a 10,000-thread projection in linear time", () => {
    const threads = Array.from({ length: 10_000 }, (_, index) =>
      thread(`thread-${index}`),
    );
    const startedAt = performance.now();
    const result = validateSidebarThreadProjection({
      projection: {
        regions: [region({ threadOrder: threads.map(({ id }) => id) })],
        excludedThreadIds: [],
      },
      threads,
      projects,
    });
    expect(result.kind).toBe("valid");
    expect(performance.now() - startedAt).toBeLessThan(1_500);
  });
});

describe("projection collapse keys", () => {
  it("isolates plugin, registration, region, project, and item identity", () => {
    const base = {
      pluginId: "plugin",
      registrationId: "registration",
      regionId: "region",
      projectId: "project",
      itemId: "thread:one",
    };
    const key = buildSidebarProjectionCollapseKey(base);
    expect(key).not.toBe(
      buildSidebarProjectionCollapseKey({ ...base, pluginId: "other" }),
    );
    expect(key).not.toBe(
      buildSidebarProjectionCollapseKey({ ...base, regionId: "other" }),
    );
    expect(key).not.toBe(
      buildSidebarProjectionCollapseKey({ ...base, projectId: "other" }),
    );
  });
});
