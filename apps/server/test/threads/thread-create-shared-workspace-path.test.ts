import {
  archiveThread,
  ensurePersonalProject,
  listEnvironments,
  listThreads,
} from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const SHARED_PATH = "/tmp/shared-workspace-path-repo";

describe("thread creation on a path another project already uses", () => {
  it("creates a project-owned environment instead of failing on the personal claim", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-shared-workspace-path",
      });
      // A personal thread that switched its directory claims the folder for the
      // personal project.
      ensurePersonalProject(harness.deps.db);
      const personalEnvironment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: PERSONAL_PROJECT_ID,
        path: SHARED_PATH,
      });

      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: SHARED_PATH,
      });

      const thread = await createThreadFromRequest(harness.deps, {
        childOrigin: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: SHARED_PATH },
        },
        input: textInput("Work in the shared folder"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      expect(thread.projectId).toBe(project.id);
      // The new project gets its own environment for the folder; the personal
      // claim stays where it was.
      const projectEnvironments = listEnvironments(harness.deps.db, project.id);
      expect(projectEnvironments).toHaveLength(1);
      expect(projectEnvironments[0]?.id).not.toBe(personalEnvironment.id);

      const provision = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "environment.provision",
      );
      expect(provision.command).toMatchObject({
        type: "environment.provision",
        environmentId: projectEnvironments[0]?.id,
        path: SHARED_PATH,
      });
    });
  });

  // Sharing the claim must not share the hazards: the directory is still one
  // physical folder, so guards about the folder stay cross-project.
  it.each(["starting", "idle", "active"] as const)(
    "refuses a branch checkout while an unarchived %s thread uses the directory",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: "host-shared-checkout",
        });
        const { project: busyProject } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          name: "Busy Project",
          path: SHARED_PATH,
        });
        const busyEnvironment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: busyProject.id,
          path: SHARED_PATH,
        });
        seedThread(harness.deps, {
          projectId: busyProject.id,
          environmentId: busyEnvironment.id,
          status,
        });

        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          name: "Checkout Project",
          path: SHARED_PATH,
        });

        await expect(
          createThreadFromRequest(harness.deps, {
            childOrigin: null,
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "unmanaged",
                path: SHARED_PATH,
                branch: { kind: "existing", name: "feature/x" },
              },
            },
            input: textInput("Check out a branch"),
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            startedOnBehalfOf: null,
          }),
        ).rejects.toThrow(
          "Cannot checkout branch while another thread is using",
        );

        // Rejected before any environment or checkout command existed.
        expect(listEnvironments(harness.deps.db, project.id)).toEqual([]);
      });
    },
  );

  it("allows a branch checkout when only an archived thread uses the directory", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-archived-checkout",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Archived Checkout Project",
        path: SHARED_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: SHARED_PATH,
      });
      const archivedThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      archiveThread(harness.deps.db, harness.deps.hub, archivedThread.id);

      const thread = await createThreadFromRequest(harness.deps, {
        childOrigin: null,
        environment: {
          type: "host",
          hostId: host.id,
          workspace: {
            type: "unmanaged",
            path: SHARED_PATH,
            branch: { kind: "existing", name: "feature/reuse-archived" },
          },
        },
        input: textInput("Reuse the archived thread's checkout"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        startedOnBehalfOf: null,
      });

      expect(thread.environmentId).toBe(environment.id);
      const provision = await waitForQueuedCommand(
        harness,
        (queued) => queued.command.type === "environment.provision",
      );
      expect(provision.command).toMatchObject({
        type: "environment.provision",
        environmentId: environment.id,
        path: SHARED_PATH,
      });
    });
  });

  it.each(["starting", "active"] as const)(
    "refuses a branch checkout while an archived %s thread can still own the directory",
    async (status) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host-archived-${status}-checkout`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          name: "Archived Running Checkout Project",
          path: SHARED_PATH,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
          path: SHARED_PATH,
        });
        const archivedThread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: environment.id,
          status,
        });
        archiveThread(harness.deps.db, harness.deps.hub, archivedThread.id);

        await expect(
          createThreadFromRequest(harness.deps, {
            childOrigin: null,
            environment: {
              type: "host",
              hostId: host.id,
              workspace: {
                type: "unmanaged",
                path: SHARED_PATH,
                branch: { kind: "existing", name: "feature/wait-for-stop" },
              },
            },
            input: textInput("Wait for the archived process to stop"),
            origin: "app",
            projectId: project.id,
            providerId: "codex",
            startedOnBehalfOf: null,
          }),
        ).rejects.toThrow(
          "Cannot checkout branch while another thread is using",
        );
      });
    },
  );

  it("rejects reuse when the environment is not ready", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-retiring-reuse",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Retiring Reuse Project",
        path: SHARED_PATH,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: SHARED_PATH,
        status: "retiring",
        isWorktree: true,
      });

      await expect(
        createThreadFromRequest(harness.deps, {
          childOrigin: null,
          environment: { type: "reuse", environmentId: environment.id },
          input: textInput("Reuse a retiring worktree"),
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          startedOnBehalfOf: null,
        }),
      ).rejects.toMatchObject({
        body: { code: "environment_not_ready" },
        status: 409,
      });

      expect(listThreads(harness.deps.db, { projectId: project.id })).toEqual(
        [],
      );
    });
  });

  it("refuses to attach in place to another project's managed worktree", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-alias",
      });
      const worktreePath = "/tmp/bb-worktrees/env_owner/repo";
      const { project: owner } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owning Project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: owner.id,
        path: worktreePath,
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Aliasing Project",
        path: "/tmp/aliasing-project",
      });

      await expect(
        createThreadFromRequest(harness.deps, {
          childOrigin: null,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: { type: "unmanaged", path: worktreePath },
          },
          input: textInput("Attach to the managed worktree"),
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          startedOnBehalfOf: null,
        }),
      ).rejects.toThrow("bb-managed workspace owned by another project");

      expect(listEnvironments(harness.deps.db, project.id)).toEqual([]);
    });
  });

  it("refuses a managed path whose owner has not stored it yet", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-pending-managed",
      });
      // A managed environment stores its path only once the host reports
      // success. Until then the row cannot defend the directory, so the
      // workspace root has to.
      const { project: owner } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Owning Project",
      });
      const pending = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: owner.id,
        path: null,
        status: "provisioning",
        managed: true,
        workspaceProvisionType: "managed-worktree",
      });

      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Racing Project",
        path: "/tmp/racing-project",
      });

      await expect(
        createThreadFromRequest(harness.deps, {
          childOrigin: null,
          environment: {
            type: "host",
            hostId: host.id,
            workspace: {
              type: "unmanaged",
              path: `${session.dataDir}/worktrees/${pending.id}/repo`,
            },
          },
          input: textInput("Race the worktree"),
          origin: "app",
          projectId: project.id,
          providerId: "codex",
          startedOnBehalfOf: null,
        }),
      ).rejects.toThrow("bb-managed workspace owned by another project");

      expect(listEnvironments(harness.deps.db, project.id)).toEqual([]);
    });
  });
});
