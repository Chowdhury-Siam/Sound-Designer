import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { mock } from "bun:test";
import { registerPlatform } from "../src/js/platform/client";
import type { SoundDesignerPlatform } from "../src/js/platform/types";

const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-atomic-save-"));
(globalThis as any).window = { cep: {} };
(globalThis as any).require = createRequire(import.meta.url);
(globalThis as any).localStorage = { getItem: () => null, setItem: () => {} };
registerPlatform({ capabilities: {} } as SoundDesignerPlatform);
mock.module("../src/js/lib/utils/bolt", () => ({ csi: { getSystemPath: () => root } }));
const originalRename = fs.renameSync;
const fail = () => { throw Object.assign(new Error("Disk replacement denied"), { code: "EACCES" }); };
try {
  const library = await import("../src/js/main/library");
  const file = library.getSharedLibraryStoragePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = JSON.stringify({ version: 1, paths: [root] });
  await writeFile(file, previous);
  fs.renameSync = fail;
  library.saveLibraryPaths([{ path: path.join(root, "new") } as any]);
  assert.equal(await readFile(file, "utf8"), previous, "Legacy library saves must not delete the previous file on failure");
  // Run the actual private JSON commit body with a failing filesystem rename.
  const source = (await readFile(new URL("../src/js/main/projectAudio.ts", import.meta.url), "utf8")).replaceAll("\r", "");
  const body = source.match(/const writeJsonAtomically = \(filePath: string, value: unknown\) => \{\n([\s\S]*?)\n\};/)?.[1];
  assert.ok(body, "Prepared audio metadata commit must be present");
  const commit = new Function("fs", "crypto", "filePath", "value", body);
  assert.throws(() => commit(fs, crypto, file, { changed: true }), /Disk replacement denied/);
  assert.equal(await readFile(file, "utf8"), previous, "Prepared audio metadata must preserve the previous file");
  assert.equal(fs.readdirSync(path.dirname(file)).filter(name => name.includes(".tmp")).length, 0, "Failed commits must clean their temporary files");
  console.log("File replacement failure regressions passed.");
} finally {
  fs.renameSync = originalRename;
  await rm(root, { recursive: true, force: true });
}
