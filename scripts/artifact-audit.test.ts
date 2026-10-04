import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { version } from "../package.json";
import { auditPayload } from "./artifact-audit";

test("artifact audit rejects contaminated payloads, wrong identities and platform inputs", async () => {
  const incomplete = spawnSync("bun", [path.join(import.meta.dir, "artifact-audit.ts"), "--arch", "x64"]);
  expect(incomplete.status).not.toBe(0);
  const directory = await mkdtemp(path.join(tmpdir(), "sounddesigner-audit-test-"));
  try {
    const manifest = `<ExtensionManifest ExtensionBundleId="com.rksound.designer" ExtensionBundleVersion="${version}"><Extension Id="com.rksound.designer.main"/></ExtensionManifest>`;
    for (const [file, content] of Object.entries({ "CSXS/manifest.xml": manifest, "main/index.html": "<html></html>", "jsx/index.js": "var host = true;", "assets/index.cjs": "var ui = true;", "assets/index.css": "body{}" })) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), content);
    }
    expect(Object.keys(await auditPayload(directory, "adobe"))).toHaveLength(5);
    await writeFile(path.join(directory, "mimetype"), "application/vnd.adobe.air-ucf-package+zip");
    expect(Object.keys(await auditPayload(directory, "adobe"))).toHaveLength(6);
    await writeFile(path.join(directory, "mimetype"), "unexpected-package");
    await expect(auditPayload(directory, "adobe")).rejects.toThrow("mimetype");
    await rm(path.join(directory, "mimetype"));
    for (const file of ["leak.map", "credentials.json", ".env.production", "cache", ".tmp-leftover", ".pw-local", "fixture.wav", "fixture.log", "test.tmp", "App.svelte", "preload.cjs", "WorkflowIntegration.node", "hidden.zip"]) {
      await writeFile(path.join(directory, file), "unsafe");
      await expect(auditPayload(directory, "adobe")).rejects.toThrow();
      await rm(path.join(directory, file));
    }
    for (const content of ["http://localhost:3000", '"M:\\Projects\\Secret"', '"Z:\\Work\\Secret"', "/Users/editor/project", "browser-segment-demo", 'freesoundApiKey:"real-private-key"', "-----BEGIN PRIVATE KEY-----", 'require("electron")']) {
      await writeFile(path.join(directory, "main/index.html"), content);
      await expect(auditPayload(directory, "adobe")).rejects.toThrow();
    }
    await writeFile(path.join(directory, "main/index.html"), "<html></html>");
    await writeFile(path.join(directory, "CSXS/manifest.xml"), manifest.replace(version, "0.0.0"));
    await expect(auditPayload(directory, "adobe")).rejects.toThrow("ID/version");
    await writeFile(path.join(directory, "CSXS/manifest.xml"), manifest);
    if (process.platform !== "win32") {
      await symlink(path.join(directory, "jsx"), path.join(directory, "linked"));
      await expect(auditPayload(directory, "adobe")).rejects.toThrow();
      await rm(path.join(directory, "linked"));
    }
    await rm(path.join(directory, "CSXS"), { recursive: true });
    await rm(path.join(directory, "jsx"), { recursive: true });
    await rm(path.join(directory, "main"), { recursive: true });
    await rm(path.join(directory, "assets"), { recursive: true });
    for (const [file, content] of Object.entries({ "manifest.xml": `<Id>com.sound.designer.resolve</Id><Version>${version}</Version>`, "package.json": JSON.stringify({ name: "com.sound.designer.resolve", version, main: "main.cjs" }), "main.cjs": "exports.main = true;", "preload.cjs": "exports.preload = true;", "ui/index.html": "<html></html>", "ui/assets/index.js": "var ui = true;", "ui/assets/index.css": "body{}" })) {
      await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
      await writeFile(path.join(directory, file), content);
    }
    await expect(auditPayload(directory, "resolve")).rejects.toThrow("missing WorkflowIntegration");
    expect(Object.keys(await auditPayload(directory, "resolve", "linux", "x64", true))).toHaveLength(7);
    await writeFile(path.join(directory, "WorkflowIntegration.node"), Buffer.alloc(128));
    await expect(auditPayload(directory, "resolve", "win32", "x64")).rejects.toThrow("Windows PE");
    await rm(path.join(directory, "WorkflowIntegration.node"));
    await writeFile(path.join(directory, "ui/assets/duplicate.css"), "body{}");
    await expect(auditPayload(directory, "resolve", "linux", "x64", true)).rejects.toThrow("exactly one");
    await rm(path.join(directory, "ui/assets/duplicate.css"));
    await writeFile(path.join(directory, "preload.cjs"), "CSInterface");
    await expect(auditPayload(directory, "resolve", "linux", "x64", true)).rejects.toThrow("CEP runtime");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
