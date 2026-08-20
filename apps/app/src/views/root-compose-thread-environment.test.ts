import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  resolveRootComposeThreadEnvironment,
  type RootComposeSelectedBranch,
} from "./root-compose-thread-environment";

const projectId = "proj_123";
const hostWorktreeEnvironmentValue = "host:host_123:worktree";
const hostLocalEnvironmentValue = "host:host_123:local";

function selectedBranch(name: string): RootComposeSelectedBranch {
  return { name, isNew: false };
}

describe("resolveRootComposeThreadEnvironment", () => {
  it("omits unmanaged branch checkout when no branch is selected", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: null,
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: {
        type: "unmanaged",
        path: null,
      },
    });
  });

  it("sends explicit existing branch checkout for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: {
          kind: "existing",
          name: "develop",
        },
      },
    });
  });

  it("sends explicit new branch checkout for host local", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: { name: "develop", isNew: true },
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: { kind: "new", baseBranch: "develop" },
      },
    });
  });

  it("sends default base branch for managed worktrees without an explicit pick", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "main",
        environmentValue: hostWorktreeEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        checkout: {
          kind: "new-branch",
          baseBranch: { kind: "default" },
        },
      },
    });
  });

  it("can submit the server-resolved default while branch metadata is still loading", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: undefined,
        defaultWorktreeBaseBranch: undefined,
        environmentValue: hostWorktreeEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        checkout: {
          kind: "new-branch",
          baseBranch: { kind: "default" },
        },
      },
    });
  });

  it("sends smart remote default base branch for managed worktrees without an explicit pick", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        checkout: {
          kind: "new-branch",
          baseBranch: { kind: "named", name: "origin/main" },
        },
      },
    });
  });

  it("sends a named base branch when the selected branch matches the env's current", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        managedMode: "new",
        projectId,
        selectedBranch: { name: "develop", isNew: true },
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        checkout: {
          kind: "new-branch",
          baseBranch: { kind: "named", name: "develop" },
        },
      },
    });
  });

  it("continues the selected branch in a managed worktree", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        managedMode: "continue",
        projectId,
        selectedBranch: selectedBranch("origin/bb/pr-123"),
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        checkout: {
          kind: "existing-branch",
          name: "origin/bb/pr-123",
        },
      },
    });
  });

  it("uses personal workspaces for the personal project", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: null,
        defaultWorktreeBaseBranch: null,
        environmentValue: hostLocalEnvironmentValue,
        managedMode: "new",
        projectId: PERSONAL_PROJECT_ID,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: { type: "personal" },
    });
  });

  it("requires a branch in managed Continue mode", () => {
    expect(
      resolveRootComposeThreadEnvironment({
        defaultBranch: "main",
        defaultWorktreeBaseBranch: "origin/main",
        environmentValue: hostWorktreeEnvironmentValue,
        managedMode: "continue",
        projectId,
        selectedBranch: null,
      }),
    ).toBeNull();
  });
});
