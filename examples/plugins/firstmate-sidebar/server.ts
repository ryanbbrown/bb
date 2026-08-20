import type { BbPluginApi } from "@get-bb/plugin-sdk";

export const managerThreadSetting = {
  type: "string",
  label: "Firstmate manager thread ID",
  description:
    "The exact thread ID for the Firstmate manager. Thread titles are not used as identity.",
  default: "",
} as const;

export default function plugin(bb: BbPluginApi) {
  bb.settings.define({
    managerThreadId: managerThreadSetting,
  });
}
