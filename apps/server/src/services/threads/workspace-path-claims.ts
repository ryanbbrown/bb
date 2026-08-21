import {
  hasLiveThreadAtHostPath,
  listActiveEnvironmentsWithPathsOnHost,
} from "@bb/db";
import type { WorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { resolveCanonicalHostPaths } from "../hosts/canonical-paths.js";
import { isBbManagedWorkspacePath } from "./worktree-paths.js";

/**
 * A workspace path is claimed per project: two projects may each hold their own
 * environment for one folder. Safety questions about the folder itself are not
 * project-scoped, though — the directory is shared physically. These helpers
 * answer those questions across every project.
 */

interface UnmanagedAttachRefusal {
  reason: "foreign-managed" | "live-thread";
  message: string;
}

interface UnmanagedAttachCheckArgs {
  /** Host data directory, for recognizing bb's own workspace roots. */
  dataDir: string | null;
  /** Set when the request also checks out a branch, which rewrites the tree. */
  checksOutBranch: boolean;
  hostId: string;
  path: string;
  projectId: string;
}

type HostEnvironment = ReturnType<
  typeof listActiveEnvironmentsWithPathsOnHost
>[number];

export interface UnmanagedAttachResolution {
  canonicalPath: string;
  existingProjectEnvironment: HostEnvironment | null;
  refusal: UnmanagedAttachRefusal | null;
}

/**
 * Why an unmanaged attach to this directory must be refused, or null when it is
 * safe. Two hazards survive project scoping:
 *
 * 1. The directory is a bb-managed workspace owned by another project. Cleanup
 *    of the owner deletes it out from under the attached thread. A managed
 *    environment stores its path only after the host reports success, so the
 *    row alone is not a reliable claim — bb's workspace roots close that
 *    window.
 * 2. A branch checkout rewrites the working tree while another project's agent
 *    is working in the same folder.
 */
export async function resolveUnmanagedAttach(
  deps: WorkSessionDeps,
  args: UnmanagedAttachCheckArgs,
): Promise<UnmanagedAttachResolution> {
  const environments = listActiveEnvironmentsWithPathsOnHost(
    deps.db,
    args.hostId,
  );
  const canonicalPaths = await resolveCanonicalHostPaths(deps, {
    hostId: args.hostId,
    paths: [
      args.path,
      ...(args.dataDir === null ? [] : [args.dataDir]),
      ...environments.flatMap((environment) =>
        environment.path === null ? [] : [environment.path],
      ),
    ],
  });
  const canonicalPath = canonicalPaths.get(args.path);
  if (canonicalPath === null || canonicalPath === undefined) {
    throw new ApiError(
      409,
      "invalid_request",
      `Workspace path does not exist: ${args.path}`,
    );
  }
  const matchingEnvironments = environments.filter(
    (environment) =>
      environment.path !== null &&
      canonicalPaths.get(environment.path) === canonicalPath,
  );
  const existingProjectEnvironment =
    matchingEnvironments.find(
      (environment) => environment.projectId === args.projectId,
    ) ?? null;
  const foreignManagedMessage =
    "Workspace path is a bb-managed workspace owned by another project";
  const canonicalDataDir =
    args.dataDir === null ? null : (canonicalPaths.get(args.dataDir) ?? null);

  if (
    matchingEnvironments.some(
      (environment) =>
        environment.managed && environment.projectId !== args.projectId,
    )
  ) {
    return {
      canonicalPath,
      existingProjectEnvironment,
      refusal: { reason: "foreign-managed", message: foreignManagedMessage },
    };
  }

  // A path under bb's workspace roots belongs to a managed environment even
  // when that environment has not stored its path yet.
  if (
    canonicalDataDir !== null &&
    isBbManagedWorkspacePath({
      dataDir: canonicalDataDir,
      path: canonicalPath,
    }) &&
    existingProjectEnvironment === null
  ) {
    return {
      canonicalPath,
      existingProjectEnvironment,
      refusal: { reason: "foreign-managed", message: foreignManagedMessage },
    };
  }

  if (
    args.checksOutBranch &&
    matchingEnvironments.some(
      (environment) =>
        environment.path !== null &&
        hasLiveThreadAtHostPath(deps.db, {
          hostId: args.hostId,
          path: environment.path,
        }),
    )
  ) {
    return {
      canonicalPath,
      existingProjectEnvironment,
      refusal: {
        reason: "live-thread",
        message:
          "Cannot checkout branch while another thread is using this workspace",
      },
    };
  }

  return { canonicalPath, existingProjectEnvironment, refusal: null };
}
