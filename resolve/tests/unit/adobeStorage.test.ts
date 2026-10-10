import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StorageService } from "../../src/main/services/storageService";
import { LibraryService } from "../../src/main/services/libraryService";

(globalThis as unknown as { window: unknown }).window = { cep: {} };
mock.module("../../../src/js/lib/utils/bolt", () => ({ csi: { getSystemPath: () => "" } }));
const { AdobeStorageService } = await import("../../../src/js/hosts/adobe/storage");

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe("Adobe portable storage", () => {
  test("shares initialization without repeated manifest reads or locks and still sees Resolve updates", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-adobe-init-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const adobe = new AdobeStorageService(pointer, root);
    const manifest = path.join(pointer, "sounddesigner.json");
    const lock = path.join(pointer, ".sounddesigner.lock");
    const reads = spyOn(fs, "readFileSync");
    const opens = spyOn(fs, "openSync");
    try {
      await Promise.all([adobe.initialize(), adobe.initialize(), adobe.initialize()]);
      expect(opens.mock.calls.filter(([file]) => file === lock)).toHaveLength(1);
      reads.mockClear();
      opens.mockClear();
      await Promise.all([adobe.initialize(), adobe.initialize()]);
      expect(reads.mock.calls.filter(([file]) => file === manifest)).toHaveLength(0);
      expect(opens.mock.calls.filter(([file]) => file === lock)).toHaveLength(0);
      const resolve = new StorageService(pointer, root);
      await resolve.initialize(root);
      await resolve.writePreferences({ normalizationTargetDb: -9 });
      await writeFile(path.join(pointer, "adobe-audio-storage.json"), JSON.stringify({ version: 2, mode: "central" }));
      expect((await adobe.initialize()).root).toBe(root);
      expect(adobe.info.audioStorageMode).toBe("central");
      expect(await adobe.getPreferences()).toMatchObject({ normalizationTargetDb: -9 });
    } finally {
      reads.mockRestore();
      opens.mockRestore();
    }
  });

  test("retries failed initialization and continues to recover later corrupt manifests", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-adobe-init-retry-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    await mkdir(pointer);
    const manifest = path.join(pointer, "sounddesigner.json");
    await writeFile(manifest, "{broken");
    const adobe = new AdobeStorageService(pointer, path.join(fixture, "central"));
    await expect(adobe.initialize()).rejects.toThrow("no valid backup");
    await writeFile(manifest, JSON.stringify({ version: 2, createdAt: "2026-01-01", preferences: { normalizationTargetDb: -6 } }));
    await adobe.initialize();
    await adobe.savePreferences({ normalizationTargetDb: -12 } as any);
    await writeFile(manifest, "{broken");
    await adobe.initialize();
    expect(await adobe.getPreferences()).toMatchObject({ normalizationTargetDb: -6 });
    expect(JSON.parse(await readFile(manifest, "utf8")).preferences.normalizationTargetDb).toBe(-6);
  });

  test("Adobe serializes simultaneous favorite and label edits", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-adobe-mutations-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const sounds = path.join(fixture, "sounds");
    await mkdir(sounds);
    await writeFile(path.join(sounds, "hit.wav"), Buffer.alloc(32));
    const resolve = new StorageService(pointer, root);
    await resolve.initialize(root);
    const initial = await new LibraryService(resolve).addFolder(sounds);
    const adobe = new AdobeStorageService(pointer, root);
    await adobe.initialize();
    const { AdobeLibraryService } = await import("../../../src/js/hosts/adobe/library");
    const library = new AdobeLibraryService(adobe);
    await Promise.all([library.setSoundFavorite(initial.sounds[0].id, true), library.setSoundLabel(initial.sounds[0].id, "blue")]);
    expect((await library.getSnapshot()).sounds[0]).toMatchObject({ favorite: true, labelColor: "blue" });
  });
  test("rejects stale whole-library replacements in both directions", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-library-conflict-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const resolve = new StorageService(pointer, root);
    await resolve.initialize(root);
    const adobe = new AdobeStorageService(pointer, root);
    await adobe.initialize();
    const baseline = JSON.stringify(await resolve.readLibrary() ?? null);
    await adobe.saveLibrary({ from: "Adobe" }, baseline);
    await expect(resolve.writeLibrary({ from: "Resolve" }, baseline)).rejects.toThrow("changed in another window");
    expect(await resolve.readLibrary()).toEqual({ from: "Adobe" });
    const next = JSON.stringify(await adobe.getLibrary());
    await resolve.writeLibrary({ from: "Resolve" }, next);
    await expect(adobe.saveLibrary({ from: "Adobe" }, next)).rejects.toThrow("changed in another window");
    expect(await adobe.getLibrary()).toEqual({ from: "Resolve" });
  });
  test("failed manifest replacement preserves the previous file in both hosts", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-save-failure-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const resolve = new StorageService(pointer, root);
    await resolve.initialize(root);
    const adobe = new AdobeStorageService(pointer, root);
    await adobe.initialize();
    await resolve.writePreferences({ keep: true });
    const manifest = path.join(pointer, "sounddesigner.json");
    const previous = await readFile(manifest, "utf8");
    const failure = Object.assign(new Error("Rename blocked"), { code: "EACCES" });
    const source = (await readFile(new URL("../../src/main/services/storageService.ts", import.meta.url), "utf8")).replaceAll("\r", "");
    const body = source.match(/private async writeJson\(filePath: string, value: unknown\): Promise<void> \{\n([\s\S]*)\n  \}\n\}/)?.[1];
    expect(body).toBeDefined();
    const commit = new Function("writeFile", "rename", "rm", "process", "filePath", "value", `return (async () => { ${body} })();`);
    await expect(commit(fsPromises.writeFile, async () => { throw failure; }, fsPromises.rm, process, manifest, { keep: false })).rejects.toThrow("Rename blocked");
    expect(await readFile(manifest, "utf8")).toBe(previous);
    const renameSync = spyOn(fs, "renameSync").mockImplementation(() => { throw failure; });
    try {
      await expect(adobe.savePreferences({ keep: false } as any)).rejects.toThrow("Rename blocked");
      expect(await readFile(manifest, "utf8")).toBe(previous);
    } finally { renameSync.mockRestore(); }
  });
  test("resets the old inferred Adobe central default once and preserves subsequent explicit choices", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-inferred-mode-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const resolve = new StorageService(pointer, root);
    await resolve.initialize(root);
    await resolve.writeLibrary({ keep: true });
    await writeFile(path.join(pointer, "adobe-audio-storage.json"), JSON.stringify({ version: 1, mode: "central" }));
    const adobe = new AdobeStorageService(pointer, root);
    expect((await adobe.initialize()).audioStorageMode).toBe("project");
    expect(await adobe.getLibrary()).toEqual({ keep: true });
    expect(JSON.parse(await readFile(path.join(pointer, "adobe-audio-storage.json"), "utf8"))).toEqual({ version: 2, mode: "project" });
    await adobe.setAudioStorageMode("central");
    await resolve.initialize();
    const reopened = new AdobeStorageService(pointer, root);
    expect((await reopened.initialize()).audioStorageMode).toBe("central");
    expect(await reopened.getLibrary()).toEqual({ keep: true });
  });

  test("cancelled or invalid folder selection preserves mode and library state", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-folder-guards-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const adobe = new AdobeStorageService(pointer, root);
    await adobe.initialize();
    await adobe.saveLibrary({ keep: true });
    const resolve = new StorageService(pointer, root);
    await resolve.initialize(root);
    const cep = (window as any).cep;
    const previousFs = cep.fs;
    try {
      cep.fs = { showOpenDialog: () => ({ data: [] }) };
      expect(await adobe.changeLocation()).toBeNull();
      for (const candidate of ["relative-folder", path.join(pointer, "audio")]) {
        cep.fs = { showOpenDialog: () => ({ data: [candidate] }) };
        await expect(adobe.changeLocation()).rejects.toThrow();
        await expect(resolve.changeRoot(candidate)).rejects.toThrow();
      }
      const invalid = path.join(fixture, "invalid");
      await mkdir(invalid);
      await writeFile(path.join(invalid, "sounddesigner.json"), "{broken");
      cep.fs = { showOpenDialog: () => ({ data: [invalid] }) };
      await expect(adobe.changeLocation()).rejects.toThrow("no valid backup");
      await expect(resolve.changeRoot(invalid)).rejects.toThrow("no valid backup");
      expect(adobe.info.audioStorageMode).toBe("project");
      expect(resolve.root).toBe(root);
      expect(await adobe.getLibrary()).toEqual({ keep: true });
      expect(await resolve.readLibrary()).toEqual({ keep: true });
    } finally { cep.fs = previousFs; }
  });

  test("a lost central pointer does not silently switch Adobe back to project storage", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-lost-pointer-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    await new StorageService(pointer, root).initialize(root);
    const adobe = new AdobeStorageService(pointer, root);
    await adobe.initialize();
    await adobe.setAudioStorageMode("central");
    await rm(path.join(pointer, "storage-location.json"));
    expect((await adobe.initialize()).audioStorageMode).toBe("central");
    await expect(adobe.getProjectRoot({ ok: true, host: "premiere", projectPath: path.join(fixture, "Film.prproj"), projectDirectory: fixture, projectName: "Film", message: "ready" })).rejects.toThrow("Choose a central audio folder");
  });

  test("defaults Adobe to beside project when Resolve configured the central folder first", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-resolve-first-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    await new StorageService(pointer, root).initialize(root);
    const adobe = new AdobeStorageService(pointer, root);
    expect((await adobe.initialize()).audioStorageMode).toBe("project");
    expect(adobe.info.root).toBe(root);
    await adobe.setAudioStorageMode("central");
    expect((await new AdobeStorageService(pointer, root).initialize()).audioStorageMode).toBe("central");
  });

  test("rejects corrupt legacy settings instead of silently creating empty state", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-corrupt-upgrade-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    await mkdir(pointer);
    await mkdir(root);
    await writeFile(path.join(pointer, "storage-location.json"), JSON.stringify({ version: 1, root }));
    await writeFile(path.join(root, "sounddesigner.json"), "{broken");
    await expect(new AdobeStorageService(pointer, root).initialize()).rejects.toThrow("no valid backup");
    await expect(new StorageService(pointer, root).initialize()).rejects.toThrow("no valid backup");
    expect(await readFile(path.join(pointer, "sounddesigner.json")).catch(() => null)).toBeNull();
    expect(await readFile(path.join(root, "sounddesigner.json"), "utf8")).toBe("{broken");
  });

  test("recovers legacy settings from a valid older backup without changing source files", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-backup-upgrade-"));
    roots.push(fixture);
    const root = path.join(fixture, "central");
    await mkdir(path.join(root, "Backups"), { recursive: true });
    const original = JSON.stringify({ version: 2, createdAt: "2026-01-01", library: { keep: true } });
    await writeFile(path.join(root, "sounddesigner.json"), "{broken");
    await writeFile(path.join(root, "Backups", "sounddesigner-100-1.json"), original);
    await writeFile(path.join(root, "Backups", "sounddesigner-200-1.json"), "{broken-newest");
    const adobePointer = path.join(fixture, "adobe-data");
    await mkdir(adobePointer);
    await writeFile(path.join(adobePointer, "storage-location.json"), JSON.stringify({ version: 1, root }));
    const adobe = new AdobeStorageService(adobePointer, root);
    await adobe.initialize();
    expect(await adobe.getLibrary()).toEqual({ keep: true });
    const resolve = new StorageService(path.join(fixture, "resolve-data"), root);
    await resolve.initialize(root);
    expect(await resolve.readLibrary()).toEqual({ keep: true });
    expect(await readFile(path.join(root, "sounddesigner.json"), "utf8")).toBe("{broken");
    expect(await readFile(path.join(root, "Backups", "sounddesigner-100-1.json"), "utf8")).toBe(original);
  });

  test("simultaneous first launch cannot overwrite another host's newly saved library", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-first-launch-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const resolve = new StorageService(pointer, root);
    const adobe = new AdobeStorageService(pointer, root);
    await Promise.all([
      resolve.initialize(root).then(() => resolve.writeLibrary({ keep: true })),
      adobe.initialize(),
    ]);
    expect(await adobe.getLibrary()).toEqual({ keep: true });
    expect(await resolve.readLibrary()).toEqual({ keep: true });
  });

  test("selects literal percent-named folders without URL-decoding native paths", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-100%20%-"));
    roots.push(pointer, root);
    const cep = (window as any).cep;
    const previousFs = cep.fs;
    cep.fs = { showOpenDialog: () => ({ data: [root] }) };
    try {
      const adobe = new AdobeStorageService(pointer, root);
      expect((await adobe.changeLocation())?.root).toBe(root);
      expect(JSON.parse(await readFile(path.join(pointer, "storage-location.json"), "utf8")).root).toBe(root);
    } finally {
      cep.fs = previousFs;
    }
  });

  test("shares live library state in both directions", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, root);
    await writeFile(path.join(pointer, "storage-location.json"), JSON.stringify({ version: 1, root }));
    const resolveStorage = new StorageService(pointer, root);
    const adobe = new AdobeStorageService(pointer, root);
    await resolveStorage.initialize(root);
    await adobe.initialize();
    const library = new LibraryService(resolveStorage);
    const document = (updatedAt: number) => ({
      version: 1 as const,
      snapshot: { folders: [], sounds: [], updatedAt },
      soundMetadata: {},
      folderMetadata: {},
    });

    await adobe.saveLibrary(document(1));
    expect((await library.getSnapshot()).updatedAt).toBe(1);
    await adobe.saveLibrary(document(2));
    expect((await library.getSnapshot()).updatedAt).toBe(2);
    await resolveStorage.writeLibrary(document(3));
    expect((await adobe.getLibrary<{ snapshot: { updatedAt: number } }>())?.snapshot.updatedAt).toBe(3);

  });

  test("shares the manifest lock with Resolve without losing either writer", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, root);
    await writeFile(path.join(pointer, "storage-location.json"), JSON.stringify({ version: 1, root }));
    const resolve = new StorageService(pointer, root);
    const adobe = new AdobeStorageService(pointer, root);
    await resolve.initialize(root);
    await adobe.initialize();

    await Promise.all([
      adobe.savePreferences({
        autoPreview: true, loop: false, localSourceEnabled: true, cloudLibraryEnabled: true,
        freesoundLibraryEnabled: false, freesoundSourceEnabled: false, insertionTarget: "playhead",
        conversionPolicy: "unsupported", normalization: "manual", normalizationTargetDb: -6,
        freesoundLicenseFilter: "commercial",
      }),
      resolve.writeLibrary({ folders: ["shared"] }),
    ]);

    const manifest = JSON.parse(await readFile(path.join(pointer, "sounddesigner.json"), "utf8"));
    expect(manifest.preferences.normalizationTargetDb).toBe(-6);
    expect(manifest.library.folders).toEqual(["shared"]);
    expect(JSON.stringify(manifest)).not.toContain("freesoundApiKey");
  });

  test("defaults to the v1.0.3 project layout without central setup and preserves files on mode changes", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-adobe-modes-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    const projectDirectory = path.join(fixture, "work");
    await mkdir(projectDirectory);
    const adobe = new AdobeStorageService(pointer, root);
    expect((await adobe.initialize()).audioStorageMode).toBe("project");
    expect(adobe.info.root).toBe("");
    await adobe.saveLibrary({ keep: true });
    const project = { ok: true as const, host: "premiere" as const, projectPath: path.join(projectDirectory, "Film.prproj"), projectDirectory, projectName: "Film", message: "ready" };
    const beside = await adobe.getProjectRoot(project);
    expect(beside).toBe(path.join(projectDirectory, "SoundDesigner", "Film"));
    const original = path.join(beside, "Segments", "old.wav");
    await writeFile(original, Buffer.from([0, 1, 254, 255]));
    await expect(adobe.getProjectRoot({ ok: false, host: "premiere", message: "Save the project" })).rejects.toThrow("Save the project");
    const cep = (window as any).cep;
    const previousFs = cep.fs;
    cep.fs = { showOpenDialog: () => ({ data: [root] }) };
    try { await adobe.changeLocation(); } finally { cep.fs = previousFs; }
    await adobe.setAudioStorageMode("central");
    const central = await adobe.getProjectRoot(project);
    expect(central.startsWith(path.join(root, "Projects", "adobe"))).toBe(true);
    expect(await readFile(path.join(central, "Segments", "old.wav")).catch(() => null)).toBeNull();
    expect(await adobe.getLibrary()).toEqual({ keep: true });
    await adobe.setAudioStorageMode("project");
    expect(await adobe.getProjectRoot(project)).toBe(beside);
    expect(await readFile(original)).toEqual(Buffer.from([0, 1, 254, 255]));
    const reopened = new AdobeStorageService(pointer, root);
    expect((await reopened.initialize()).audioStorageMode).toBe("project");
    await new StorageService(pointer, root).initialize(root);
    expect((await reopened.initialize()).audioStorageMode).toBe("project");
  });

  test("imports existing shared settings once while defaulting Adobe to beside project", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-adobe-upgrade-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const root = path.join(fixture, "central");
    await mkdir(pointer);
    await mkdir(root);
    await writeFile(path.join(pointer, "storage-location.json"), JSON.stringify({ version: 1, root }));
    const original = JSON.stringify({ version: 2, createdAt: "2026-01-01", library: { preserved: true } });
    await writeFile(path.join(root, "sounddesigner.json"), original);
    await new StorageService(pointer, root).initialize();
    const adobe = new AdobeStorageService(pointer, root);
    expect((await adobe.initialize()).audioStorageMode).toBe("project");
    expect(await adobe.getLibrary()).toEqual({ preserved: true });
    await adobe.saveLibrary({ updated: true });
    expect(await readFile(path.join(root, "sounddesigner.json"), "utf8")).toBe(original);
    await adobe.initialize();
    expect(await adobe.getLibrary()).toEqual({ updated: true });
  });
});
