import {
  useCallback,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { PluginReplacementSlot } from "@/components/plugin/PluginReplacementSlot";
import { useSidebar } from "@/components/ui/sidebar.js";
import { useRouteState } from "@/hooks/useRouteState";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import {
  BoundSidebarThreadProjection,
  SidebarThreadProjectionBindingContext,
} from "./SidebarThreadProjectionRenderer";

/** Shared by the mount and the host's crash check. */
export const THREAD_LIST_SLOT_KIND = "threadList";

interface PluginThreadListProps {
  replacement: ResolvedReplacement<PluginThreadListSlot>;
  /** BB's list bound to this sidebar instance. */
  original: ReactNode;
  /** The host search field's text; "" when closed or plugin-owned. */
  searchQuery: string;
  /** Private search state distinguishes a closed field from active empty search. */
  isSearchActive: boolean;
  onNavigate: () => void;
}

function BoundPluginThreadList({
  BoundOriginal,
  activeProjectId,
  activeThreadId,
  isCompactViewport,
  isSearchActive,
  onNavigate,
  searchQuery,
  slot,
}: {
  BoundOriginal: ComponentType;
  activeProjectId: string | null;
  activeThreadId: string | null;
  isCompactViewport: boolean;
  isSearchActive: boolean;
  onNavigate: () => void;
  searchQuery: string;
  slot: PluginThreadListSlot;
}) {
  const projectionBinding = useMemo(
    () => ({
      activeThreadId,
      generation: slot.generation,
      isSearchActive,
      onNavigate,
      original: BoundOriginal,
      pluginId: slot.pluginId,
      registrationId: slot.id,
    }),
    [
      BoundOriginal,
      activeThreadId,
      isSearchActive,
      onNavigate,
      slot.generation,
      slot.id,
      slot.pluginId,
    ],
  );
  const Component = slot.component;
  return (
    <SidebarThreadProjectionBindingContext.Provider value={projectionBinding}>
      <Component
        activeThreadId={activeThreadId}
        activeProjectId={activeProjectId}
        isCompactViewport={isCompactViewport}
        onNavigate={onNavigate}
        searchQuery={searchQuery}
        experimental_Original={BoundOriginal}
        experimental_SidebarThreadProjection={BoundSidebarThreadProjection}
      />
    </SidebarThreadProjectionBindingContext.Provider>
  );
}

/** Mounts the active exclusive thread-list provider with owner fallback. */
export function PluginThreadList({
  replacement,
  original,
  searchQuery,
  isSearchActive,
  onNavigate,
}: PluginThreadListProps) {
  const { projectId, threadId } = useRouteState();
  const { isCompactViewport } = useSidebar();
  const title =
    replacement.kind === "plugin" ? replacement.registration.title : "Plugin";
  const handleCrash = useCallback(
    (pluginId: string) => {
      toast.error("Sidebar plugin crashed", {
        description: `${title} (${pluginId}) stopped working, so bb's own thread list is back.`,
      });
    },
    [title],
  );

  return (
    <PluginReplacementSlot
      replacement={replacement}
      original={original}
      slotKind={THREAD_LIST_SLOT_KIND}
      onCrash={handleCrash}
    >
      {(slot, BoundOriginal) => (
        <BoundPluginThreadList
          BoundOriginal={BoundOriginal}
          activeProjectId={projectId ?? null}
          activeThreadId={threadId ?? null}
          isCompactViewport={isCompactViewport}
          isSearchActive={isSearchActive}
          onNavigate={onNavigate}
          searchQuery={searchQuery}
          slot={slot}
        />
      )}
    </PluginReplacementSlot>
  );
}
