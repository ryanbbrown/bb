// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "./AppSidebar";
import { sidebarShowThreadNumbersAtom } from "./sidebarCollapsedAtoms";

const { appCommandShortcuts, routeState, setRootComposeProjectId } = vi.hoisted(
  () => ({
    appCommandShortcuts: new Map(),
    routeState: { projectId: "project-1", threadId: "thread-1" },
    setRootComposeProjectId: vi.fn(),
  }),
);

vi.mock("./ProjectList", () => ({
  ProjectList: () => (
    <a
      href="/projects/project-1/threads/thread-1"
      data-sidebar-thread-shortcut-target
      data-sidebar-thread-id="thread-1"
    >
      Thread one
    </a>
  ),
  ProjectListActionButtons: ({ onNewChat }: { onNewChat?: () => void }) => (
    <button type="button" onClick={onNewChat}>
      New thread
    </button>
  ),
}));

vi.mock("./PluginThreadList", () => ({
  PluginThreadList: () => null,
}));

vi.mock("./threadListProvider", () => ({
  useThreadListReplacement: () => null,
}));

vi.mock("@/components/plugin/PluginNavSidebarItems", () => ({
  PluginNavSidebarItems: () => null,
}));

vi.mock("@/components/plugin/PluginSidebarFooterActions", () => ({
  PluginSidebarFooterActions: () => null,
}));

vi.mock("./SidebarUpdatesBadge", () => ({
  SidebarUpdatesBadge: () => null,
}));

vi.mock("./SidebarPluginAttentionGlyph", () => ({
  SidebarPluginAttentionGlyph: () => null,
}));

vi.mock("./SidebarHistoryNavigationControls", () => ({
  SidebarHistoryNavigationControls: () => null,
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
  usePaneContentSplitDrag: () => undefined,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandHandler: vi.fn(),
  useAppCommandShortcut: () => null,
  useAppCommandShortcuts: () => appCommandShortcuts,
  useIndexedAppCommandHandlers: vi.fn(),
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => routeState,
}));

vi.mock("@/lib/root-compose-selection", () => ({
  useSetRootComposeProjectId: () => setRootComposeProjectId,
}));

class RecordingMutationObserver implements MutationObserver {
  static instances: RecordingMutationObserver[] = [];

  readonly disconnect = vi.fn();
  observedRoot: Node | null = null;

  constructor(readonly callback: MutationCallback) {
    RecordingMutationObserver.instances.push(this);
  }

  observe(target: Node): void {
    this.observedRoot = target;
  }

  takeRecords(): MutationRecord[] {
    return [];
  }
}

afterEach(() => {
  cleanup();
  RecordingMutationObserver.instances = [];
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function renderAppSidebar(
  isCompactViewport: boolean,
  store: ReturnType<typeof createStore>,
) {
  return (
    <CompactViewportOverrideProvider isCompactViewport={isCompactViewport}>
      <Provider store={store}>
        <MemoryRouter>
          <SidebarProvider>
            <AppSidebar
              onResizeMouseDown={vi.fn()}
              isResizing={false}
              showTopReserve={false}
              settingsRoutePath="/settings"
            />
          </SidebarProvider>
        </MemoryRouter>
      </Provider>
    </CompactViewportOverrideProvider>
  );
}

describe("AppSidebar", () => {
  it("uses the active project when the New thread button opens the composer", () => {
    vi.stubGlobal("MutationObserver", RecordingMutationObserver);
    const store = createStore();

    render(renderAppSidebar(false, store));
    fireEvent.click(screen.getByRole("button", { name: "New thread" }));

    expect(setRootComposeProjectId).toHaveBeenCalledWith("project-1");
  });

  it("rebinds thread shortcut observation to the compact sidebar root", () => {
    vi.stubGlobal("MutationObserver", RecordingMutationObserver);
    const store = createStore();
    store.set(sidebarShowThreadNumbersAtom, true);

    const view = render(renderAppSidebar(false, store));

    expect(RecordingMutationObserver.instances).toHaveLength(1);
    const desktopObserver = RecordingMutationObserver.instances[0];
    const desktopRoot = desktopObserver?.observedRoot;
    expect(desktopRoot?.isConnected).toBe(true);

    view.rerender(renderAppSidebar(true, store));

    expect(desktopObserver?.disconnect).toHaveBeenCalledOnce();
    expect(desktopRoot?.isConnected).toBe(false);
    expect(RecordingMutationObserver.instances).toHaveLength(2);
    const compactRoot = RecordingMutationObserver.instances[1]?.observedRoot;
    expect(compactRoot).not.toBe(desktopRoot);
    expect(compactRoot?.isConnected).toBe(true);
  });
});
