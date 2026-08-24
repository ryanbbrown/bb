// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@/test/fixtures/thread-list-entries";
import { validateSidebarThreadProjection } from "@/components/sidebar/sidebarThreadProjection";
import { useSidebarThreads } from "./plugin-sidebar-hooks";

const state = vi.hoisted(() => ({
  data: undefined as
    | {
        sections: never[];
        projects: { id: string; name: string; threads: ThreadListEntry[] }[];
        personalProject: {
          id: string;
          name: string;
          threads: ThreadListEntry[];
        };
      }
    | undefined,
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: state.data, isError: false }),
}));

vi.mock("@/hooks/queries/host-queries", () => {
  // Stable like the real query result; a fresh array per render would rebuild
  // the host-name map and (correctly) invalidate every cached DTO.
  const hosts: never[] = [];
  return { useHosts: () => ({ data: hosts }) };
});

function payload(threads: ThreadListEntry[]) {
  return {
    sections: [],
    projects: [{ id: "proj_app", name: "App", threads }],
    personalProject: { id: PERSONAL_PROJECT_ID, name: "Personal", threads: [] },
  };
}

afterEach(() => {
  cleanup();
  state.data = undefined;
});

describe("useSidebarThreads", () => {
  it("keeps DTO identity for entries that did not change across a sidebar update", () => {
    const stable = makeThreadListEntry({ id: "thr_stable", title: "Stable" });
    const changing = makeThreadListEntry({ id: "thr_changing", title: "One" });
    state.data = payload([stable, changing]);
    const { result, rerender } = renderHook(() => useSidebarThreads());
    const before = result.current.threads;
    expect(before.map((thread) => thread.id)).toEqual([
      "thr_stable",
      "thr_changing",
    ]);

    // React Query structurally shares the payload: a refetch that touched
    // one thread keeps the other entry objects. Plugin rows memoized on their
    // thread DTO must get the same object back for the untouched thread.
    state.data = payload([
      stable,
      makeThreadListEntry({ id: "thr_changing", title: "Two" }),
    ]);
    rerender();
    const after = result.current.threads;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.title).toBe("Two");
  });

  it("shares DTO identity between two consumers of the same payload", () => {
    const stable = makeThreadListEntry({ id: "thr_stable", title: "Stable" });
    state.data = payload([stable]);
    const first = renderHook(() => useSidebarThreads());
    const second = renderHook(() => useSidebarThreads());
    // Two plugin lists mounted at once (or one list plus the built-in
    // sidebar's plugin surfaces): each derives the host-name map from the
    // same hosts payload, so they must not evict each other's cached DTOs.
    expect(second.result.current.threads[0]).toBe(
      first.result.current.threads[0],
    );
    const before = first.result.current.threads[0];
    first.rerender();
    second.rerender();
    expect(first.result.current.threads[0]).toBe(before);
    expect(second.result.current.threads[0]).toBe(before);
  });

  it("omits hidden threads, so a plugin cannot be handed one", () => {
    state.data = payload([
      makeThreadListEntry({ id: "thr_visible" }),
      makeThreadListEntry({ id: "thr_worker", visibility: "hidden" }),
    ]);

    const { result } = renderHook(() => useSidebarThreads());

    expect(result.current.threads.map((thread) => thread.id)).toEqual([
      "thr_visible",
    ]);
  });

  // The seam's contract is strict coverage of eligible threads. Built-in
  // plugins (side chat, workflows) create hidden threads in normal use, so if
  // this hook leaked one, the obvious plugin — place everything you can see —
  // would fail validation forever and the sidebar would never project.
  it("hands a plugin a thread set that validates as a complete projection", () => {
    const hiddenWorker = makeThreadListEntry({
      id: "thr_worker",
      visibility: "hidden",
    });
    const threads = [
      makeThreadListEntry({ id: "thr_one" }),
      hiddenWorker,
      makeThreadListEntry({ id: "thr_two" }),
    ];
    state.data = payload(threads);
    const { result } = renderHook(() => useSidebarThreads());

    const projection = {
      regions: [
        {
          id: "all",
          label: "Threads",
          placement: "sticky",
          dividerAfter: false,
          collapsible: false,
          nesting: "native",
          grouping: { kind: "none" },
          threadOrder: result.current.threads.map((thread) => thread.id),
        },
      ],
      excludedThreadIds: [],
    };

    const validation = validateSidebarThreadProjection({
      projection,
      threads: [...threads, ...payload([]).personalProject.threads],
      projects: result.current.projects.map((project) => ({ id: project.id })),
    });

    expect(validation.kind).toBe("valid");
    if (validation.kind !== "valid") return;
    expect(validation.projection.regions[0]?.threadOrder).toEqual([
      "thr_one",
      "thr_two",
    ]);
  });
});
