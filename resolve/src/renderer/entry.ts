import { mount } from "svelte";
import "../../../src/js/index.scss";
import App from "../../../src/js/main/App.svelte";
import { registerPlatform } from "../../../src/js/platform/client";
import { createResolvePlatform } from "./bridge";

const platform = createResolvePlatform();
registerPlatform(platform);
platform.initialize();

mount(App, { target: document.getElementById("app") as HTMLElement });
