// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useThreadSplitsEnabled", () => ({
  useThreadSplitsEnabled: () => false,
}));
vi.mock("./paneContentSplitIndicator", () => ({
  useThreadGroupSplitIndicator: () => ({
    isOpenInSplit: false,
    miniMap: null,
  }),
}));

const { TopLevelSidebarSection } = await import("./TopLevelSidebarSection");

afterEach(cleanup);

describe("TopLevelSidebarSection keyboard focus", () => {
  it("keeps a visible focus ring on a draggable built-in label", () => {
    render(
      <TopLevelSidebarSection
        label="Draggable"
        dragBindings={{
          attributes: {
            role: "button",
            tabIndex: 0,
            "aria-disabled": false,
            "aria-pressed": undefined,
            "aria-roledescription": "sortable",
            "aria-describedby": "drag-description",
          },
          disabled: false,
          listeners: {},
          setActivatorNodeRef: vi.fn(),
        }}
      >
        content
      </TopLevelSidebarSection>,
    );
    const label = screen.getByRole("button", { name: "Draggable" });
    expect(label.className).toContain("focus-visible:ring-2");
    expect(label.className).toContain("outline-hidden");
    expect(label.className).not.toContain("outline-none");
  });

  it("keeps a visible focus ring on a projected collapse label control", () => {
    render(
      <TopLevelSidebarSection
        label="Projected"
        collapseControl={{ isCollapsed: false, onToggleCollapsed: vi.fn() }}
      >
        content
      </TopLevelSidebarSection>,
    );
    const control = screen.getByRole("button", {
      name: "Collapse Projected section",
    });
    expect(control.className).toContain("focus-visible:ring-2");
    expect(control.className).toContain("outline-hidden");
    expect(control.className).not.toContain("outline-none");
  });
});
