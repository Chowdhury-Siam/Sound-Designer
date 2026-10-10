import { mount } from "svelte";
import "../index.scss";
import App from "./App.svelte";
import { createAdobePlatform } from "../hosts/adobe/platform";
import { registerPlatform } from "../platform/client";
import { applyHostTheme } from "./theme";
import { syncAdobeTheme } from "../hosts/adobe/theme";
import { csi } from "../lib/utils/bolt";

const platform = createAdobePlatform();
registerPlatform(platform);
applyHostTheme(platform.mode);
if (platform.mode === "adobe") {
  const disposeTheme = syncAdobeTheme(csi);
  window.addEventListener("pagehide", event => { if (!event.persisted) disposeTheme(); });
}
platform.initialize();

mount(App, {
  target: document.getElementById("app") as HTMLElement,
});
