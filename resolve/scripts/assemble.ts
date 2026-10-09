import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { PLUGIN_ID, PLUGIN_VERSION } from "../src/shared/types";
import { validateNativeModule } from "./native-module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.join(root, "dist", "plugin", PLUGIN_ID);
const nativeRoot = path.join(root, "dist", "native");
const rendererRoot = path.join(root, "dist", "renderer");
const configuredModule = process.env.RESOLVE_WORKFLOW_NODE?.trim();
const bundledModule = process.platform === "win32"
  ? path.join(root, "vendor", "windows", "WorkflowIntegration.node")
  : process.platform === "darwin"
    ? path.join(root, "vendor", "macos", "WorkflowIntegration.node")
    : undefined;
const windowsSdkModule = process.platform === "win32" && process.env.ProgramData
  ? path.join(process.env.ProgramData, "Blackmagic Design", "DaVinci Resolve", "Support", "Developer", "Workflow Integrations", "Examples", "SamplePromisePlugin", "WorkflowIntegration.node")
  : undefined;
const workflowModule = [configuredModule, bundledModule, windowsSdkModule]
  .filter((value): value is string => Boolean(value))
  .find(existsSync);

if (!existsSync(path.join(nativeRoot, "main.cjs")) || !existsSync(path.join(nativeRoot, "preload.cjs"))) {
  throw new Error("Build the Resolve main process and preload before assembly.");
}
if (!existsSync(path.join(rendererRoot, "index.html"))) throw new Error("Build the shared Resolve renderer before assembly.");
if (!workflowModule && process.env.ALLOW_MISSING_NATIVE !== "1") {
  throw new Error("WorkflowIntegration.node was not found. Set RESOLVE_WORKFLOW_NODE or place the target module under resolve/vendor/<platform>.");
}
if (workflowModule) validateNativeModule(await readFile(workflowModule), process.platform, process.env.RESOLVE_TARGET_ARCH || process.arch);

await rm(path.dirname(pluginRoot), { recursive: true, force: true });
await mkdir(pluginRoot, { recursive: true });
await cp(path.join(nativeRoot, "main.cjs"), path.join(pluginRoot, "main.cjs"));
await cp(path.join(nativeRoot, "preload.cjs"), path.join(pluginRoot, "preload.cjs"));
await cp(rendererRoot, path.join(pluginRoot, "ui"), { recursive: true });
if (process.platform === "darwin") {
  const architecture = process.env.RESOLVE_TARGET_ARCH || process.arch;
  const module = path.join(pluginRoot, "macos-menu.node");
  const source = path.join(root, "src", "main", "native", "macos-menu.mm");
  const result = spawnSync("/usr/bin/xcrun", ["clang++", "-bundle", "-fobjc-arc", "-framework", "AppKit", "-arch", architecture === "x64" ? "x86_64" : architecture, "-mmacosx-version-min=11.0", source, "-o", module], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Could not build the macOS menu-title bridge. Install Xcode Command Line Tools and rebuild.");
  validateNativeModule(await readFile(module), "darwin", architecture);
}

const manifestSource = await readFile(path.join(root, "src", "manifest.xml"), "utf8");
if (!manifestSource.includes(`<Version>${PLUGIN_VERSION}</Version>`)) {
  throw new Error("Resolve constants and manifest.xml versions do not match.");
}
await writeFile(path.join(pluginRoot, "manifest.xml"), manifestSource, "utf8");
await writeFile(path.join(pluginRoot, "package.json"), JSON.stringify({
  name: PLUGIN_ID,
  displayName: "SoundDesigner for DaVinci Resolve",
  version: PLUGIN_VERSION,
  description: "Sound effects workspace for DaVinci Resolve Studio",
  main: "main.cjs",
  private: true,
}, null, 2) + "\n", "utf8");

if (workflowModule) await cp(workflowModule, path.join(pluginRoot, "WorkflowIntegration.node"));
console.log(`Assembled shared-UI Resolve artifact ${pluginRoot}`);
console.log(workflowModule ? `Native module: ${workflowModule}` : "Native module intentionally omitted for static CI build.");
