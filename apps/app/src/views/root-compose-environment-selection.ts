import {
  findLocalPathProjectSourceForHost,
  type ProjectSource,
  type ThreadListEntry,
} from "@bb/domain";
import type {
  ProjectBranchesResponse,
  ProjectWorktree,
  SystemProvidersQuery,
} from "@bb/server-contract";
import {
  encodeHostValue,
  encodeReuseValue,
  encodeWorktreePathValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "@/components/pickers/environment-picker-value";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { getThreadDisplayTitle } from "@/lib/thread-title";

/**
 * Pure environment-selection resolvers shared by every new-thread compose
 * surface: `RootComposeView` (the primary one) and `PluginNewThreadComposer`
 * (the SDK's `experimental_NewThreadComposer`). They take plain data and
 * return plain data, so both surfaces resolve a picker selection into a
 * create-thread environment the same way.
 */

interface ResolveRootComposeEffectiveEnvironmentValueArgs {
  environmentSelectionValue: string;
  isProjectless: boolean;
  /** Ids of all hosts known to the server. */
  knownHostIds: ReadonlySet<string>;
  primaryHostId: string | null;
  projectSources: readonly ProjectSource[];
  reuseThreadOptions: readonly ReuseThreadOption[];
  reuseThreadOptionsLoading: boolean;
}

const PROJECT_SOURCE_NOT_GIT_WORKTREE_DISABLED_REASON =
  "New worktrees require a Git repository with at least one commit";
const PROJECT_SOURCE_NO_COMMITS_WORKTREE_DISABLED_REASON =
  "Project source has no commits. Create an initial commit before creating a worktree";

function isWorktreeWithEnv(thread: ThreadListEntry): boolean {
  if (thread.environmentId === null) return false;
  return (
    thread.environmentWorkspaceDisplayKind === "managed-worktree" ||
    thread.environmentWorkspaceDisplayKind === "unmanaged-worktree"
  );
}

export function buildReuseThreadOptions(
  threads: readonly ThreadListEntry[],
  worktrees: readonly ProjectWorktree[],
  /** Host id → machine name, provided only when worktree rows should carry a
   * machine hint when more than one host exists. */
  hostNameById: ReadonlyMap<string, string> | null = null,
): ReuseThreadOption[] {
  // Threads within each environment are sorted by recent activity.
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  const branchByEnvironmentId = new Map<string, string | null>();
  const nameByEnvironmentId = new Map<string, string | null>();
  for (const thread of threads) {
    if (!isWorktreeWithEnv(thread)) continue;
    if (thread.environmentId === null) continue;
    let bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (!bucket) {
      bucket = [];
      threadsByEnvironmentId.set(thread.environmentId, bucket);
      branchByEnvironmentId.set(
        thread.environmentId,
        thread.environmentBranchName,
      );
      nameByEnvironmentId.set(thread.environmentId, thread.environmentName);
    }
    bucket.push(thread);
  }
  const options: ReuseThreadOption[] = [];
  for (const worktree of worktrees) {
    const environmentId = worktree.environmentId;
    const bucket = environmentId
      ? (threadsByEnvironmentId.get(environmentId) ?? [])
      : [];
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    options.push({
      value: environmentId
        ? encodeReuseValue(environmentId)
        : encodeWorktreePathValue(worktree.hostId, worktree.path),
      environmentId,
      path: worktree.path,
      branchName:
        worktree.branchName ??
        (environmentId ? branchByEnvironmentId.get(environmentId) : null) ??
        null,
      name:
        worktree.environmentName ??
        (environmentId ? nameByEnvironmentId.get(environmentId) : null) ??
        null,
      hostName:
        hostNameById !== null
          ? (hostNameById.get(worktree.hostId) ?? null)
          : null,
      threads: bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    const leftLabel = left.name ?? left.branchName;
    const rightLabel = right.name ?? right.branchName;
    if (leftLabel && rightLabel) {
      return leftLabel.localeCompare(rightLabel);
    }
    return left.path.localeCompare(right.path);
  });
  return options;
}

export function resolveProjectSourceWorktreeDisabledReason(
  data: ProjectBranchesResponse | undefined,
): string | null {
  switch (data?.checkout.kind) {
    case "unknown":
      return PROJECT_SOURCE_NOT_GIT_WORKTREE_DISABLED_REASON;
    case "unborn":
      return PROJECT_SOURCE_NO_COMMITS_WORKTREE_DISABLED_REASON;
    case "branch":
    case "detached":
    case undefined:
      return null;
  }
}

export function resolveRootComposeEffectiveEnvironmentValue({
  environmentSelectionValue,
  isProjectless,
  knownHostIds,
  primaryHostId,
  projectSources,
  reuseThreadOptions,
  reuseThreadOptionsLoading,
}: ResolveRootComposeEffectiveEnvironmentValueArgs): string {
  if (!primaryHostId) {
    return "";
  }

  const parsedSelection = parseEnvironmentValue(environmentSelectionValue);

  // A host selection survives as long as that machine still exists and has
  // this project. Otherwise it falls through to the primary-host rewrite.
  if (
    parsedSelection?.type === "host" &&
    knownHostIds.has(parsedSelection.hostId)
  ) {
    // Projectless threads run in the machine's personal workspace — no
    // project source is required and there is no worktree mode to keep.
    if (isProjectless) {
      return encodeHostValue(parsedSelection.hostId, "local");
    }
    if (
      findLocalPathProjectSourceForHost(
        projectSources,
        parsedSelection.hostId,
      ) !== undefined
    ) {
      return environmentSelectionValue;
    }
  }
  const canUseHostWorkspace =
    isProjectless ||
    findLocalPathProjectSourceForHost(projectSources, primaryHostId) !==
      undefined;
  const fallbackHostValue = canUseHostWorkspace
    ? encodeHostValue(primaryHostId, "local")
    : "";

  if (isProjectless) {
    return fallbackHostValue;
  }

  if (parsedSelection?.type === "worktree-path") {
    if (reuseThreadOptionsLoading) return REUSE_VALUE_WITHOUT_ENVIRONMENT;
    return knownHostIds.has(parsedSelection.hostId) &&
      reuseThreadOptions.some(
        (option) => option.value === environmentSelectionValue,
      )
      ? environmentSelectionValue
      : fallbackHostValue;
  }

  if (parsedSelection?.type === "reuse") {
    if (parsedSelection.environmentId === null) {
      return reuseThreadOptionsLoading || reuseThreadOptions.length > 0
        ? environmentSelectionValue
        : fallbackHostValue;
    }

    if (reuseThreadOptionsLoading) {
      return REUSE_VALUE_WITHOUT_ENVIRONMENT;
    }

    return reuseThreadOptions.some(
      (option) => option.environmentId === parsedSelection.environmentId,
    )
      ? environmentSelectionValue
      : fallbackHostValue;
  }

  if (!canUseHostWorkspace) {
    return "";
  }

  if (parsedSelection?.type === "host") {
    return encodeHostValue(primaryHostId, parsedSelection.mode);
  }

  return fallbackHostValue;
}

/**
 * The machine the composed thread will run on: the effective selection's host
 * when it names one, otherwise the primary. Provider-CLI status, update
 * actions, and submit blocking all key off this host — the primary's CLI
 * state must not gate work targeted at another machine.
 */
export function resolveComposeHostId(
  parsedEnvironment: ReturnType<typeof parseEnvironmentValue>,
  primaryHostId: string | null,
): string | null {
  return parsedEnvironment?.type === "host" ||
    parsedEnvironment?.type === "worktree-path"
    ? parsedEnvironment.hostId
    : primaryHostId;
}

export function resolveRootComposeProjectRouting(
  parsedEnvironment: ReturnType<typeof parseEnvironmentValue>,
  primaryHostId: string | null,
): { environmentId?: string; hostId?: string } {
  if (parsedEnvironment?.type === "reuse") {
    return parsedEnvironment.environmentId === null
      ? {}
      : { environmentId: parsedEnvironment.environmentId };
  }
  if (parsedEnvironment?.type === "worktree-path") {
    return { hostId: parsedEnvironment.hostId };
  }
  const hostId = resolveComposeHostId(parsedEnvironment, primaryHostId);
  return hostId === null ? {} : { hostId };
}

export function resolveRootComposeProviderRouting(
  args: ResolveRootComposeEffectiveEnvironmentValueArgs,
): SystemProvidersQuery {
  const parsed = parseEnvironmentValue(
    resolveRootComposeEffectiveEnvironmentValue(args),
  );
  if (parsed?.type === "host" || parsed?.type === "worktree-path") {
    return { hostId: parsed.hostId };
  }
  if (parsed?.type === "reuse" && parsed.environmentId !== null) {
    return { environmentId: parsed.environmentId };
  }
  return {};
}
