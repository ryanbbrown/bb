import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { managerThreadSetting } from "./server";

describe("Firstmate sidebar settings", () => {
  it("defines an explicit manager thread ID string setting", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "firstmate-sidebar",
    });

    await plugin(bb);

    expect(harness.inspection.registrations.settingsDescriptors).toEqual({
      managerThreadId: managerThreadSetting,
    });
    await expect(
      harness.behavior.setSettings({ managerThreadId: true }),
    ).rejects.toThrow(/expects a string/i);
    await harness.lifecycle.dispose();
  });
});
