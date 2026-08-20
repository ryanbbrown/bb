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

  if (settings.isLoading || typeof managerThreadId !== "string") {
    return <props.experimental_Original />;
  }

  const result = projectFirstmateThreads(state, managerThreadId);
  if (result.kind === "fallback") {
    return <props.experimental_Original />;
  }

  return (
    <props.experimental_SidebarThreadProjection
      projection={result.projection}
    />
  );
}
