import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PLUGIN_ID } from "../src/shared/types";
import { validateNativeModule } from "./native-module";
import { installDevelopmentPlugin } from "./install-transaction";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "dist", "plugin", PLUGIN_ID);
let pluginRoot: string;
if (process.platform === "win32") {
  const programData = process.env.ProgramData;
  if (!programData) throw new Error("ProgramData is unavailable.");
  pluginRoot = path.resolve(programData, "Blackmagic Design", "DaVinci Resolve", "Support", "Workflow Integration Plugins");
} else if (process.platform === "darwin") {
  pluginRoot = path.resolve("/Library", "Application Support", "Blackmagic Design", "DaVinci Resolve", "Workflow Integration Plugins");
} else {
  throw new Error("Resolve Workflow Integration plugins are supported only on Windows and macOS.");
}
const destination = path.join(pluginRoot, PLUGIN_ID);
if (!destination.startsWith(pluginRoot + path.sep)) throw new Error("Refusing to install outside the Resolve Workflow Integration Plugins root.");
if (!existsSync(path.join(source, "manifest.xml")) || !existsSync(path.join(source, "WorkflowIntegration.node"))) {
  throw new Error("Build and audit the Resolve plugin before installation.");
}
validateNativeModule(await readFile(path.join(source, "WorkflowIntegration.node")), process.platform, process.env.RESOLVE_TARGET_ARCH || process.arch);

const backup = await installDevelopmentPlugin(source, pluginRoot);
console.log(`Installed development plugin to ${destination}`);
if (backup) console.log(`Previous plugin retained at ${backup}`);
console.log("Restart DaVinci Resolve Studio before testing.");
