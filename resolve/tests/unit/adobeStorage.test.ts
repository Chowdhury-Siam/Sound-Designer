import { afterEach, describe, expect, mock, test } from "bun:test";
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

    const manifest = JSON.parse(await readFile(path.join(root, "sounddesigner.json"), "utf8"));
    expect(manifest.preferences.normalizationTargetDb).toBe(-6);
    expect(manifest.library.folders).toEqual(["shared"]);
    expect(JSON.stringify(manifest)).not.toContain("freesoundApiKey");
  });

  test("imports only the current Adobe project, verifies copies, and remains idempotent", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    const projectDirectory = await mkdtemp(path.join(tmpdir(), "sounddesigner-project-"));
    roots.push(pointer, root, projectDirectory);
    await writeFile(path.join(pointer, "storage-location.json"), JSON.stringify({ version: 1, root }));
    const legacy = path.join(projectDirectory, "SoundDesigner", "同じ名前", "Segments", "legacy.wav");
    await mkdir(path.dirname(legacy), { recursive: true });
    const original = Buffer.from([0, 1, 2, 3, 254, 255]);
    await writeFile(legacy, original);
    const adobe = new AdobeStorageService(pointer, root);
    await new StorageService(pointer, root).initialize(root);
    await adobe.initialize();
    const project = { ok: true as const, host: "premiere" as const, projectPath: path.join(projectDirectory, "同じ名前.prproj"), projectDirectory, projectName: "同じ名前", message: "ready" };

    const first = await adobe.getProjectRoot(project);
    const second = await adobe.getProjectRoot(project);

    expect(second).toBe(first);
    expect(await readFile(path.join(first, "Segments", "legacy.wav"))).toEqual(original);
    expect(await readFile(legacy)).toEqual(original);
    const manifest = JSON.parse(await readFile(path.join(root, "sounddesigner.json"), "utf8"));
    expect(Object.keys(manifest.migrations)).toHaveLength(1);
    expect(Object.keys(manifest.projects)).toHaveLength(1);
  });
});
