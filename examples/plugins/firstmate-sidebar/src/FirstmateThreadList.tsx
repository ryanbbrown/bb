import { useMemo } from "react";
import {
  experimental_useSidebarThreads as useSidebarThreads,
  useSettings,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { projectFirstmateThreads } from "./projection";

export function FirstmateThreadList(props: PluginThreadListProps) {
  const state = useSidebarThreads();
  const settings = useSettings();
  const managerThreadId = settings.values?.managerThreadId;

  const result = useMemo(
    () =>
      !settings.isLoading && typeof managerThreadId === "string"
        ? projectFirstmateThreads(state, managerThreadId)
        : ({
            kind: "fallback",
            reason: "manager-setting-unavailable",
          } as const),
    [managerThreadId, settings.isLoading, state],
  );

  if (settings.isLoading || typeof managerThreadId !== "string") {
    return <props.experimental_Original />;
  }

  if (result.kind === "fallback") {
    return <props.experimental_Original />;
  }

  return (
    <props.experimental_SidebarThreadProjection
      projection={result.projection}
    />
  );
}
