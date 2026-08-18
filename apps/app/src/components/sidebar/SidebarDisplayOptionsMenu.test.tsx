// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SidebarDisplayOptionsMenu } from "./ProjectList";
import {
  SIDEBAR_PROJECT_ORDER_STORAGE_KEY,
  SIDEBAR_SHOW_THREAD_NUMBERS_STORAGE_KEY,
  sidebarOrganizationModeAtom,
  sidebarProjectOrderAtom,
} from "./sidebarCollapsedAtoms";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function renderMenu(store = createStore()) {
  return render(
    <JotaiProvider store={store}>
      <TooltipProvider>
        <SidebarDisplayOptionsMenu open onOpenChange={() => {}} />
      </TooltipProvider>
    </JotaiProvider>,
  );
}

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

    renderMenu(store);

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
    const projectRender = renderMenu(projectStore);

    expect(screen.getByRole("group", { name: "Section order" })).not.toBeNull();
    projectRender.unmount();

    const manualStore = createStore();
    manualStore.set(sidebarOrganizationModeAtom, "chronological");
    renderMenu(manualStore);

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

describe("SidebarDisplayOptionsMenu thread numbers", () => {
  it("keeps thread numbers off by default and remembers when they are shown", () => {
    const firstRender = renderMenu();
    const threadNumbers = screen.getByRole("menuitemcheckbox", {
      name: "Thread numbers",
    });

    expect(threadNumbers.getAttribute("aria-checked")).toBe("false");
    expect(
      window.localStorage.getItem(SIDEBAR_SHOW_THREAD_NUMBERS_STORAGE_KEY),
    ).toBeNull();

    fireEvent.click(threadNumbers);

    expect(threadNumbers.getAttribute("aria-checked")).toBe("true");
    expect(
      window.localStorage.getItem(SIDEBAR_SHOW_THREAD_NUMBERS_STORAGE_KEY),
    ).toBe("true");

    firstRender.unmount();
    renderMenu();

    expect(
      screen
        .getByRole("menuitemcheckbox", { name: "Thread numbers" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
