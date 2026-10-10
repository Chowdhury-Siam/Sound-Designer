import { mount } from "svelte";
import "../../../src/js/index.scss";
import App from "../../../src/js/main/App.svelte";
import { registerPlatform } from "../../../src/js/platform/client";
import { createResolvePlatform } from "./bridge";
import { applyHostTheme } from "../../../src/js/main/theme";

const platform = createResolvePlatform();
registerPlatform(platform);
applyHostTheme(platform.mode);
platform.initialize();

mount(App, { target: document.getElementById("app") as HTMLElement });
