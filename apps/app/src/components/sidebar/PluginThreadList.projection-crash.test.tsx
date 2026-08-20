// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk";
import type { ResolvedReplacement } from "@/lib/plugin-slot-resolvers";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";

const mocks = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("@/components/ui/sidebar.js", () => ({
  useSidebar: () => ({ isCompactViewport: false }),
}));
vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ projectId: null, threadId: null }),
}));
vi.mock("@/lib/plugin-css", () => ({ usePluginCss: () => undefined }));
vi.mock("./SidebarThreadProjectionRenderer", async () => {
  const { createContext } = await import("react");
  return {
    SidebarThreadProjectionBindingContext: createContext(null),
    BoundSidebarThreadProjection: () => {
      throw new Error("native projection row failed");
    },
  };
});

const { PluginThreadList } = await import("./PluginThreadList");

function ProjectionProvider(props: PluginThreadListProps) {
  return (
    <props.experimental_SidebarThreadProjection
      projection={{ regions: [], excludedThreadIds: [] }}
    />
  );
}

const replacement: ResolvedReplacement<PluginThreadListSlot> = {
  kind: "plugin",
  registration: {
    id: "projection-provider",
    title: "Projection provider",
    component: ProjectionProvider,
    pluginId: "projection-plugin",
    generation: 1,
  },
};

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginThreadList projection crash fallback", () => {
  it("restores the complete native Original list when projection rendering throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <PluginThreadList
        replacement={replacement}
        original={<div data-testid="native-original">Native thread list</div>}
        searchQuery=""
        isSearchActive={false}
        onNavigate={() => undefined}
      />,
    );

    expect(screen.getAllByTestId("native-original")).toHaveLength(1);
    expect(screen.getByText("Native thread list")).toBeDefined();
    expect(mocks.toastError).toHaveBeenCalledWith(
      "Sidebar plugin crashed",
      expect.objectContaining({
        description: expect.stringContaining("bb's own thread list is back"),
      }),
    );
  });
});
