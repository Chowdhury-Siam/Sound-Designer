import { mount } from "svelte";
import "../index.scss";
import App from "./App.svelte";
import { createAdobePlatform } from "../hosts/adobe/platform";
import { registerPlatform } from "../platform/client";

const platform = createAdobePlatform();
registerPlatform(platform);
platform.initialize();

mount(App, {
  target: document.getElementById("app") as HTMLElement,
});
