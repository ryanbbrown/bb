import type { ThreadListEntry } from "@bb/domain";
import {
  compareCodepoint,
  compareStandardThreads,
  isSidebarProjectThread,
} from "@bb/client-core";
import {
  type SidebarProjectOrder,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";

export interface ProjectActivityGroup {
  id: SidebarSectionId;
  threads: readonly ThreadListEntry[];
}

interface GetProjectModeSectionOrderArgs {
  effectivePinnedThreadIds: ReadonlySet<string>;
  groups: readonly ProjectActivityGroup[];
  manualOrder: readonly SidebarSectionId[];
  orderMode: SidebarProjectOrder;
  showPinnedSection: boolean;
}

interface RankedProjectActivityGroup {
  group: ProjectActivityGroup;
  highestRankedThread: ThreadListEntry | null;
  manualPosition: number;
}

function findHighestRankedThread(
  threads: readonly ThreadListEntry[],
  effectivePinnedThreadIds: ReadonlySet<string>,
): ThreadListEntry | null {
  let highestRankedThread: ThreadListEntry | null = null;
  for (const thread of threads) {
    if (
      !isSidebarProjectThread(thread) ||
      effectivePinnedThreadIds.has(thread.id)
    ) {
      continue;
    }
    if (
      highestRankedThread === null ||
      compareStandardThreads(thread, highestRankedThread) < 0
    ) {
      highestRankedThread = thread;
    }
  }
  return highestRankedThread;
}

export function getProjectModeSectionOrder({
  effectivePinnedThreadIds,
  groups,
  manualOrder,
  orderMode,
  showPinnedSection,
}: GetProjectModeSectionOrderArgs): SidebarSectionId[] {
  if (orderMode === "manual") {
    return [...manualOrder];
  }

  const manualPositions = new Map(
    manualOrder.map((sectionId, index) => [sectionId, index]),
  );
  const rankedGroups: RankedProjectActivityGroup[] = groups.map((group) => ({
    group,
    highestRankedThread: findHighestRankedThread(
      group.threads,
      effectivePinnedThreadIds,
    ),
    manualPosition: manualPositions.get(group.id) ?? Number.POSITIVE_INFINITY,
  }));

  rankedGroups.sort((left, right) => {
    if (left.highestRankedThread && right.highestRankedThread) {
      return compareStandardThreads(
        left.highestRankedThread,
        right.highestRankedThread,
      );
    }
    if (left.highestRankedThread) return -1;
    if (right.highestRankedThread) return 1;

    if (left.manualPosition !== right.manualPosition) {
      return left.manualPosition - right.manualPosition;
    }
    return compareCodepoint(left.group.id, right.group.id);
  });

  return [
    ...(showPinnedSection ? (["pinned"] as const) : []),
    ...rankedGroups.map(({ group }) => group.id),
  ];
}
