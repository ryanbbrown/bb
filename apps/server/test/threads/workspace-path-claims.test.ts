import { describe, expect, it } from "vitest";
import { resolveUnmanagedAttach } from "../../src/services/threads/workspace-path-claims.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const HOST_DATA_DIR = "/home/agent/.bb";

describe("unmanagedAttachRefusal", () => {
  it("refuses an alias into the managed workspace root without an environment path", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claims-managed-root-alias",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/other",
      });
      const aliasPath = "/tmp/managed-worktree-alias";
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type !== "host.resolve_paths") {
            throw new Error(`Unexpected command: ${request.command.type}`);
          }
          return {
            ok: true,
            result: {
              paths: request.command.paths.map((candidate) => ({
                path: candidate,
                canonicalPath:
                  candidate === aliasPath
                    ? `${HOST_DATA_DIR}/worktrees/env_other/repo`
                    : candidate,
              })),
            },
          };
        },
      });

      expect(
        (
          await resolveUnmanagedAttach(harness.deps, {
            checksOutBranch: false,
            dataDir: HOST_DATA_DIR,
            hostId: host.id,
            path: aliasPath,
            projectId: project.id,
          })
        ).refusal,
      ).toMatchObject({ reason: "foreign-managed" });
    });
  });

  it("refuses a foreign managed workspace through a path alias", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claims",
      });
      const { project: owner } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: owner.id,
        path: "/tmp/owned-worktree",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Other",
        path: "/tmp/other",
      });

      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => ({
          ok: true,
          result: {
            paths:
              request.command.type === "host.resolve_paths"
                ? request.command.paths.map((candidate) => ({
                    path: candidate,
                    canonicalPath:
                      candidate === "/tmp/owned-worktree-alias"
                        ? "/tmp/owned-worktree"
                        : candidate,
                  }))
                : [],
          },
        }),
      });
      expect(
        (
          await resolveUnmanagedAttach(harness.deps, {
            checksOutBranch: false,
            dataDir: null,
            hostId: host.id,
            path: "/tmp/owned-worktree-alias",
            projectId: project.id,
          })
        ).refusal,
      ).toMatchObject({ reason: "foreign-managed" });
    });
  });

  it("allows an ordinary directory when the host data dir is unknown", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claims-ok",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/plain",
      });

      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => ({
          ok: true,
          result: {
            paths:
              request.command.type === "host.resolve_paths"
                ? request.command.paths.map((candidate) => ({
                    path: candidate,
                    canonicalPath: candidate,
                  }))
                : [],
          },
        }),
      });
      expect(
        (
          await resolveUnmanagedAttach(harness.deps, {
            checksOutBranch: false,
            dataDir: null,
            hostId: host.id,
            path: `${HOST_DATA_DIR}/worktrees/env_other/repo`,
            projectId: project.id,
          })
        ).refusal,
      ).toBeNull();
    });
  });

  it("lets a project attach to a managed path it already owns", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claims-own",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owner",
      });
      const ownPath = `${HOST_DATA_DIR}/worktrees/env_own/repo`;
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: ownPath,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => ({
          ok: true,
          result: {
            paths:
              request.command.type === "host.resolve_paths"
                ? request.command.paths.map((candidate) => ({
                    path: candidate,
                    canonicalPath: candidate,
                  }))
                : [],
          },
        }),
      });
      expect(
        (
          await resolveUnmanagedAttach(harness.deps, {
            checksOutBranch: false,
            dataDir: HOST_DATA_DIR,
            hostId: host.id,
            path: ownPath,
            projectId: project.id,
          })
        ).refusal,
      ).toBeNull();
    });
  });

  it("ignores live threads unless the request checks out a branch", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claims-busy",
      });
      const sharedPath = "/tmp/busy-shared";
      const { project: busy } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Busy",
        path: sharedPath,
      });
      const busyEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: busy.id,
        path: sharedPath,
      });
      seedThread(harness.deps, {
        projectId: busy.id,
        environmentId: busyEnvironment.id,
        status: "active",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Joiner",
        path: sharedPath,
      });

      const args = {
        dataDir: HOST_DATA_DIR,
        hostId: host.id,
        path: sharedPath,
        projectId: project.id,
      };
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => ({
          ok: true,
          result: {
            paths:
              request.command.type === "host.resolve_paths"
                ? request.command.paths.map((candidate) => ({
                    path: candidate,
                    canonicalPath: candidate,
                  }))
                : [],
          },
        }),
      });
      // Sharing a directory is allowed; only rewriting the tree is not.
      expect(
        (
          await resolveUnmanagedAttach(harness.deps, {
            ...args,
            checksOutBranch: false,
          })
        ).refusal,
      ).toBeNull();
      expect(
        (
          await resolveUnmanagedAttach(harness.deps, {
            ...args,
            checksOutBranch: true,
          })
        ).refusal,
      ).toMatchObject({ reason: "live-thread" });
    });
  });
});
