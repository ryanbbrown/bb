// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BranchPicker } from "./BranchPicker";

afterEach(cleanup);

function ManagedBranchPickerHarness() {
  const [selection, setSelection] = useState<{
    branch: string | null;
    mode: "new" | "continue";
  }>({
    branch: "main",
    mode: "new",
  });
  return (
    <BranchPicker
      value={selection.branch}
      isCreatingNew={selection.mode === "new"}
      managedMode={selection.mode}
      menuKind="managed"
      options={["main"]}
      remoteOptions={["origin/main", "origin/bb/pr-42"]}
      defaultOpen
      modal={false}
      triggerLabel={
        selection.mode === "new"
          ? `Branch from: ${selection.branch ?? "main"}`
          : `Continue: ${selection.branch ?? "Select branch"}`
      }
      onChange={(branch) => setSelection({ branch, mode: "continue" })}
      onCreate={() => setSelection({ branch: "main", mode: "new" })}
      onCreateBaseChange={(branch) => setSelection({ branch, mode: "new" })}
      onContinue={() => setSelection({ branch: null, mode: "continue" })}
    />
  );
}

describe("managed BranchPicker", () => {
  it("defaults to New branch and requires a target after switching to Continue", () => {
    render(<ManagedBranchPickerHarness />);

    expect(
      screen
        .getByRole("combobox", { name: "Branch" })
        .querySelector('[title="Branch from: main"]'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue branch" }));
    expect(
      screen
        .getByRole("combobox", { name: "Branch" })
        .querySelector('[title="Continue: Select branch"]'),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "main" }));
    expect(
      screen
        .getByRole("combobox", { name: "Branch" })
        .querySelector('[title="Continue: main"]'),
    ).toBeTruthy();
  });

  it("continues a selected remote branch", () => {
    render(<ManagedBranchPickerHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Continue branch" }));
    fireEvent.click(screen.getByRole("button", { name: "origin/bb/pr-42" }));
    expect(
      screen
        .getByRole("combobox", { name: "Branch" })
        .querySelector('[title="Continue: origin/bb/pr-42"]'),
    ).toBeTruthy();
  });
});
