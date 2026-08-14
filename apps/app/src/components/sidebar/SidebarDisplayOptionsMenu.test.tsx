// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import {
  SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
  sidebarOrganizationModeAtom,
  sidebarProjectOrderAtom,
} from "./sidebarCollapsedAtoms";

function Menu({ store }: { store: ReturnType<typeof createStore> }) {
  return (
    <JotaiProvider store={store}>
      <TooltipProvider>
        <SidebarDisplayOptionsMenu open />
      </TooltipProvider>
    </JotaiProvider>
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("SidebarDisplayOptionsMenu project order", () => {
  it("defaults to drag order when storage is empty", () => {
    const store = createStore();

    expect(window.localStorage.getItem(SIDEBAR_PROJECT_ORDER_STORAGE_KEY)).toBe(
      null,
    );
    expect(store.get(sidebarProjectOrderAtom)).toBe("manual");
  });

  it("changes the browser-local project order", () => {
    const store = createStore();
    store.set(sidebarOrganizationModeAtom, "project");
    store.set(sidebarProjectOrderAtom, "recent");

    render(<Menu store={store} />);

    fireEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "Drag order" }),
    );

    expect(store.get(sidebarProjectOrderAtom)).toBe("manual");
    expect(window.localStorage.getItem(SIDEBAR_PROJECT_ORDER_STORAGE_KEY)).toBe(
      "manual",
    );
  });

  it("shows project order controls only in project organization mode", () => {
    const projectStore = createStore();
    projectStore.set(sidebarOrganizationModeAtom, "project");
    const projectRender = render(<Menu store={projectStore} />);

    expect(screen.getByRole("group", { name: "Section order" })).not.toBeNull();
    projectRender.unmount();

    const manualStore = createStore();
    manualStore.set(sidebarOrganizationModeAtom, "chronological");
    render(<Menu store={manualStore} />);

    expect(screen.queryByRole("group", { name: "Section order" })).toBeNull();
  });

  it("resolves an invalid stored project order to drag order", () => {
    window.localStorage.setItem(
      SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
      "invalid-project-order",
    );
    const store = createStore();

    expect(store.get(sidebarProjectOrderAtom)).toBe("manual");
  });
});
