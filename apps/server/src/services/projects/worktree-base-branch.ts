import type { ProjectSourceCheckout } from "@bb/domain";

export interface ResolveDefaultWorktreeBaseBranchArgs {
  defaultBranch: ProjectSourceCheckout["defaultBranch"];
  defaultBranchRelation: ProjectSourceCheckout["defaultBranchRelation"];
  originDefaultBranch: ProjectSourceCheckout["originDefaultBranch"];
}

export function resolveDefaultWorktreeBaseBranch(
  args: ResolveDefaultWorktreeBaseBranchArgs,
): string | null {
  if (!args.originDefaultBranch) {
    return args.defaultBranch;
  }
  if (!args.defaultBranch) {
    return args.originDefaultBranch;
  }
  if (
    args.defaultBranchRelation === "equal" ||
    args.defaultBranchRelation === "local-behind"
  ) {
    return args.originDefaultBranch;
  }
  return args.defaultBranch;
}
