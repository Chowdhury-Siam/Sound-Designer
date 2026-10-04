import { describe, expect, test } from "bun:test";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";

const projectRoot = path.resolve(import.meta.dir, "..", "..");
const rendererRoot = path.join(projectRoot, "resolve", "src", "renderer");
const mainRoot = path.join(projectRoot, "src", "js", "main");

const filesBelow = async (root: string): Promise<string[]> => {
  const files: string[] = [];
  const visit = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const location = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(location);
      else files.push(location);
    }
  };
  await visit(root);
  return files;
};

describe("shared renderer boundary", () => {
  test("Resolve source contains no UI components or stylesheet fork", async () => {
    const files = await filesBelow(path.join(projectRoot, "resolve", "src"));
    expect(files.filter(file => /\.(?:svelte|scss|sass|css)$/.test(file))).toEqual([]);
  });
  test("Resolve renderer contains only the entry and adapter", async () => {
    const files = (await filesBelow(rendererRoot)).map((file) => path.relative(rendererRoot, file).replaceAll("\\", "/")).sort();
    expect(files).toEqual(["bridge.ts", "entry.ts"]);
  });

  test("both host entries import the authoritative App", async () => {
    const adobe = await readFile(path.join(mainRoot, "index-svelte.ts"), "utf8");
    const resolve = await readFile(path.join(rendererRoot, "entry.ts"), "utf8");
    expect(adobe).toContain('import App from "./App.svelte"');
    expect(resolve).toContain('import App from "../../../src/js/main/App.svelte"');
    expect(resolve).toContain('import "../../../src/js/index.scss"');
  });

  test("shared components do not import host runtimes or raw filesystem APIs", async () => {
    const componentRoot = path.join(mainRoot, "components");
    const forbidden = /from\s+["'][^"']*(?:electron|resolve[\\/]|lib[\\/]cep|node:fs|node:path)[^"']*["']/i;
    for (const file of await filesBelow(componentRoot)) {
      if (!/\.(?:svelte|ts)$/.test(file)) continue;
      expect(await readFile(file, "utf8")).not.toMatch(forbidden);
    }
  });
});
