// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectResponse } from "@bb/server-contract";

const state = vi.hoisted(() => ({
  primaryHost: { id: "host-a", status: "connected" } as {
    id: string;
    status: "connected";
  } | null,
  existence: {} as Record<string, boolean>,
  requested: null as null | { hostId: string | null; paths: readonly string[] },
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  usePrimaryHost: () => state.primaryHost,
}));
vi.mock("@/hooks/queries/host-path-queries", () => ({
  useHostPathExistence: (hostId: string | null, paths: readonly string[]) => {
    state.requested = { hostId, paths };
    return state.existence;
  },
  isHostPathMissing: (
    existence: Record<string, boolean>,
    path: string | undefined,
  ) => path !== undefined && existence[path] === false,
}));

const { useSidebarProjectPathInvalidity } =
  await import("./useSidebarProjectPathInvalidity");

function project(id: string, path: string): ProjectResponse {
  return {
    id,
    kind: "standard",
    name: id,
    gitRemoteUrl: null,
    sources: [
      {
        id: `source-${id}`,
        projectId: id,
        isDefault: true,
        type: "local_path",
        hostId: "host-a",
        path,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

beforeEach(() => {
  state.primaryHost = { id: "host-a", status: "connected" };
  state.existence = {};
  state.requested = null;
});

describe("useSidebarProjectPathInvalidity", () => {
  it("shares host path probing and marks only definitively missing paths", () => {
    state.existence = { "/missing": false, "/present": true };
    const { result } = renderHook(() =>
      useSidebarProjectPathInvalidity([
        project("missing", "/missing"),
        project("present", "/present"),
      ]),
    );
    expect(state.requested).toEqual({
      hostId: "host-a",
      paths: ["/missing", "/present"],
    });
    expect([...result.current]).toEqual(["missing"]);
  });

  it("does not warn while the primary host or path result is unavailable", () => {
    state.primaryHost = null;
    const { result } = renderHook(() =>
      useSidebarProjectPathInvalidity([project("project", "/missing")]),
    );
    expect(state.requested).toEqual({ hostId: null, paths: [] });
    expect(result.current.size).toBe(0);
  });
});
