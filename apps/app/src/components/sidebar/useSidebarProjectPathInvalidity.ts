import { useMemo } from "react";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import type { ProjectResponse } from "@bb/server-contract";
import {
  isHostPathMissing,
  useHostPathExistence,
} from "@/hooks/queries/host-path-queries";
import { usePrimaryHost } from "@/hooks/queries/host-queries";

const EMPTY_INVALID_PROJECT_IDS: ReadonlySet<string> = new Set();

/** Shared host/path policy for every native sidebar project heading. */
export function useSidebarProjectPathInvalidity(
  projects: readonly ProjectResponse[],
): ReadonlySet<string> {
  const primaryHost = usePrimaryHost();
  const workHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const targets = useMemo(() => {
    if (!workHostId) return [];
    return projects.flatMap((project) => {
      const source = findLocalPathProjectSourceForHost(
        project.sources,
        workHostId,
      );
      return source ? [{ path: source.path, projectId: project.id }] : [];
    });
  }, [projects, workHostId]);
  const paths = useMemo(() => targets.map(({ path }) => path), [targets]);
  const existence = useHostPathExistence(workHostId, paths);

  return useMemo(() => {
    if (targets.length === 0) return EMPTY_INVALID_PROJECT_IDS;
    const invalid = new Set<string>();
    for (const target of targets) {
      if (isHostPathMissing(existence, target.path)) {
        invalid.add(target.projectId);
      }
    }
    return invalid;
  }, [existence, targets]);
}
