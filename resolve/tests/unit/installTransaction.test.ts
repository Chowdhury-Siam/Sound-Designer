import { afterEach, expect, test } from "bun:test";
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { installDevelopmentPlugin } from "../../scripts/install-transaction";
import { PLUGIN_ID } from "../../src/shared/types";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-dev-install-"));
  roots.push(root);
  const source = path.join(root, "source");
  const pluginRoot = path.join(root, "plugins");
  const installed = path.join(pluginRoot, PLUGIN_ID);
  await mkdir(source, { recursive: true });
  await mkdir(installed, { recursive: true });
  await writeFile(path.join(source, "main.cjs"), "new");
  await writeFile(path.join(installed, "main.cjs"), "old");
  return { source, pluginRoot, installed };
};
test("failed staging leaves the installed development plugin untouched", async () => {
  const { source, pluginRoot, installed } = await fixture();
  await expect(installDevelopmentPlugin(source, pluginRoot, async () => { throw new Error("Copy failed"); })).rejects.toThrow("Copy failed");
  expect(await readFile(path.join(installed, "main.cjs"), "utf8")).toBe("old");
});
test("failed replacement restores the previous development plugin", async () => {
  const { source, pluginRoot, installed } = await fixture();
  const move: typeof rename = async (from, to) => {
    if (path.basename(String(from)) === "incoming") throw new Error("Swap failed");
    await rename(from, to);
  };
  await expect(installDevelopmentPlugin(source, pluginRoot, undefined, move)).rejects.toThrow("Swap failed");
  expect(await readFile(path.join(installed, "main.cjs"), "utf8")).toBe("old");
});
test("successful development replacement retains the previous plugin outside discovery", async () => {
  const { source, pluginRoot, installed } = await fixture();
  const backup = await installDevelopmentPlugin(source, pluginRoot);
  expect(await readFile(path.join(installed, "main.cjs"), "utf8")).toBe("new");
  expect(await readFile(path.join(backup!, "main.cjs"), "utf8")).toBe("old");
  expect(backup!.startsWith(pluginRoot + path.sep)).toBe(false);
});
test("legacy plugins are preserved and require explicit relocation", async () => {
  const { source, pluginRoot, installed } = await fixture();
  const legacy = path.join(pluginRoot, "com.rksound.designer.resolve");
  await mkdir(legacy);
  await writeFile(path.join(legacy, "main.cjs"), "legacy");
  await expect(installDevelopmentPlugin(source, pluginRoot)).rejects.toThrow("has not been deleted");
  expect(await readFile(path.join(legacy, "main.cjs"), "utf8")).toBe("legacy");
  expect(await readFile(path.join(installed, "main.cjs"), "utf8")).toBe("old");
});
