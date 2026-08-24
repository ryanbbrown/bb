// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginThreadListProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import type { PluginThreadListSlot } from "@/lib/plugin-slots";
import { PluginThreadList } from "./PluginThreadList";

vi.mock("@/lib/plugin-css", () => ({ usePluginCss: () => {} }));

const receivedProps: PluginThreadListProps[] = [];

function ProbeThreadList(props: PluginThreadListProps) {
  receivedProps.push(props);
  return <div data-testid="plugin-list" />;
}

const registration: PluginThreadListSlot = {
  id: "sidebar",
  title: "Firstmate",
  component: ProbeThreadList,
  pluginId: "firstmate",
  generation: 1,
};

function renderList({
  isSearchFieldOpen,
  searchQuery,
}: {
  isSearchFieldOpen: boolean;
  searchQuery: string;
}) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <PluginThreadList
          replacement={{ kind: "plugin", registration }}
          original={<div data-testid="original-list" />}
          searchQuery={searchQuery}
          isSearchFieldOpen={isSearchFieldOpen}
          onNavigate={() => {}}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

describe("PluginThreadList", () => {
  afterEach(() => {
    cleanup();
    receivedProps.length = 0;
  });

  // `searchQuery === ""` cannot distinguish a closed field from an open, empty
  // one, so the open flag has to travel separately.
  it.each([
    ["closed and empty", false, ""],
    ["open and empty", true, ""],
    ["open with a query", true, "alpha"],
  ])(
    "passes the %s search state through",
    (_name, isSearchFieldOpen, query) => {
      renderList({ isSearchFieldOpen, searchQuery: query });

      expect(screen.getByTestId("plugin-list")).not.toBeNull();
      const props = receivedProps.at(-1);
      expect(props?.experimental_isSearchFieldOpen).toBe(isSearchFieldOpen);
      expect(props?.searchQuery).toBe(query);
    },
  );

  it("supplies a stable projection renderer across re-renders", () => {
    const { rerender } = renderList({
      isSearchFieldOpen: false,
      searchQuery: "",
    });
    rerender(
      <MemoryRouter>
        <SidebarProvider>
          <PluginThreadList
            replacement={{ kind: "plugin", registration }}
            original={<div data-testid="original-list" />}
            searchQuery="alpha"
            isSearchFieldOpen
            onNavigate={() => {}}
          />
        </SidebarProvider>
      </MemoryRouter>,
    );

    const [first, last] = [receivedProps[0], receivedProps.at(-1)];
    expect(first?.experimental_SidebarThreadProjection).toBe(
      last?.experimental_SidebarThreadProjection,
    );
    expect(first?.experimental_Original).toBe(last?.experimental_Original);
  });
});
