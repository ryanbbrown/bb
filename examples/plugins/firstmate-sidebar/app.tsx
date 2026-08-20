import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { FirstmateThreadList } from "./src/FirstmateThreadList";

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "firstmate",
    title: "Firstmate sidebar",
    description:
      "One Firstmate manager above managed sessions and independent threads grouped by project.",
    component: FirstmateThreadList,
  });
});
