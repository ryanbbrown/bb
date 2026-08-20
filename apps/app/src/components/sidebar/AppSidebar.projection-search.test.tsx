// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  isActive: false,
  query: "",
  captured: [] as Array<{ isSearchActive: boolean; searchQuery: string }>,
}));

vi.mock("./PluginThreadList", () => ({
  PluginThreadList: (props: {
    isSearchActive: boolean;
    searchQuery: string;
  }) => {
    state.captured.push(props);
    return <div data-testid="thread-list" />;
  },
}));
vi.mock("./ProjectList", () => ({
  ProjectList: () => <div />,
  ProjectListActionButtons: () => <div />,
}));
vi.mock("./threadListProvider", () => ({
  useThreadListReplacement: () => ({ kind: "owner" }),
}));
vi.mock("./useSidebarThreadSearch", () => ({
  useSidebarThreadSearch: () => ({
    activeDescendantId: undefined,
    activeIndex: 0,
    inputRef: { current: null },
    isActive: state.isActive,
    onActivate: vi.fn(),
    onActiveIndexChange: vi.fn(),
    onClose: vi.fn(),
    onExternalThreadOpen: vi.fn(),
    onKeyDown: vi.fn(),
    onNavigationItemsChange: vi.fn(),
    onQueryChange: vi.fn(),
    onSelectItem: vi.fn(),
    query: state.query,
  }),
}));
vi.mock("@/components/ui/sidebar.js", () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenu: ({ children }: { children: ReactNode }) => <ul>{children}</ul>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SidebarMenuItem: ({ children }: { children: ReactNode }) => (
    <li>{children}</li>
  ),
  useCloseMobileSidebar: () => vi.fn(),
  useSidebar: () => ({
    isCompactViewport: false,
    setOpen: vi.fn(),
    setOpenMobile: vi.fn(),
  }),
}));
vi.mock("@/components/plugin/PluginNavSidebarItems", () => ({
  PluginNavSidebarItems: () => null,
}));
vi.mock("@/components/plugin/PluginSidebarFooterActions", () => ({
  PluginSidebarFooterActions: () => null,
}));
vi.mock("./SidebarPluginAttentionGlyph", () => ({
  SidebarPluginAttentionGlyph: () => null,
}));
vi.mock("./SidebarUpdatesBadge", () => ({ SidebarUpdatesBadge: () => null }));
vi.mock("./SidebarHistoryNavigationControls", () => ({
  SidebarHistoryNavigationControls: () => null,
}));
vi.mock("@/components/ui/overflow-fade.js", () => ({
  OverflowFade: () => null,
}));
vi.mock("@/hooks/useQuickCreateProject", () => ({
  useQuickCreateProjectController: () => ({
    isAvailable: false,
    isCreating: false,
    openCreateDialog: vi.fn(),
  }),
}));
vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitDrag: () => ({ openInSplit: vi.fn() }),
}));
vi.mock("@bb/shared-ui/hooks/use-pointer-coarse", () => ({
  usePointerCoarse: () => false,
}));
vi.mock("@/lib/bb-desktop", () => ({
  CHROME_ROW_CLASS: "",
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS: "",
  MACOS_WINDOW_DRAG_CLASS: "",
  getBbDesktopInfo: () => null,
  shouldUseMacosDesktopChrome: () => false,
}));
vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ threadId: null, projectId: null }),
}));
vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: vi.fn(),
  useAppCommandShortcut: () => undefined,
  useAppCommandShortcuts: () => new Map(),
  useIndexedAppCommandHandlers: vi.fn(),
  useIsAppCommandModifierHeld: () => false,
}));
vi.mock("./sidebarThreadShortcuts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./sidebarThreadShortcuts")>();
  return {
    ...actual,
    getSidebarThreadNavigationTargets: () => [],
    getSidebarThreadShortcutTargets: () => [],
  };
});

const { AppSidebar } = await import("./AppSidebar");

function renderSidebar() {
  return render(
    <MemoryRouter>
      <AppSidebar
        onResizeMouseDown={vi.fn()}
        isResizing={false}
        showTopReserve={false}
        settingsRoutePath="/settings"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  state.isActive = false;
  state.query = "";
  state.captured = [];
});

afterEach(cleanup);

describe("AppSidebar projection search context", () => {
  it.each(["", "matching text"])(
    "passes active search for query %j to the projection host",
    (query) => {
      state.isActive = true;
      state.query = query;
      renderSidebar();
      expect(state.captured.at(-1)).toMatchObject({
        isSearchActive: true,
        searchQuery: query,
      });
    },
  );
});
