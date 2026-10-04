import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { StorageService } from "../../src/main/services/storageService";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("portable storage", () => {
  test("discovers the legacy Resolve root/index without replacing a shared root", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-legacy-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "shared-pointer");
    const legacy = path.join(fixture, "legacy-pointer");
    const oldRoot = path.join(fixture, "old-root");
    const sharedRoot = path.join(fixture, "shared-root");
    await mkdir(legacy, { recursive: true });
    const oldPointer = JSON.stringify({ version: 1, root: oldRoot });
    const oldIndex = JSON.stringify({ version: 1, snapshot: { folders: [], sounds: [], updatedAt: 123 } });
    await writeFile(path.join(legacy, "storage-location.json"), oldPointer);
    await writeFile(path.join(legacy, "library-index.json"), oldIndex);
    const storage = new StorageService(pointer, sharedRoot, legacy);
    expect(await storage.hasConfiguredRoot()).toBe(true);
    await storage.initialize();
    expect(storage.root).toBe(oldRoot);
    expect((await storage.readLibrary<any>()).snapshot.updatedAt).toBe(123);
    await storage.writeLibrary({ keepCurrent: true });
    await new StorageService(pointer, sharedRoot, legacy).initialize();
    expect(await storage.readLibrary()).toEqual({ keepCurrent: true });
    await storage.changeRoot(sharedRoot);
    await storage.writeLibrary({ shared: true });
    const reopened = new StorageService(pointer, oldRoot, legacy);
    await reopened.initialize();
    expect(reopened.root).toBe(sharedRoot);
    expect(await reopened.readLibrary()).toEqual({ shared: true });
    expect(await readFile(path.join(legacy, "storage-location.json"), "utf8")).toBe(oldPointer);
    expect(await readFile(path.join(legacy, "library-index.json"), "utf8")).toBe(oldIndex);
  });

  test("keeps library and preferences in application data when the audio destination changes", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const first = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    const second = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, first, second);
    const storage = new StorageService(pointer, first);
    await storage.initialize(first);
    await storage.writeLibrary({ version: 1, snapshot: { folders: [], sounds: [], updatedAt: 0 } });
    await storage.writePreferences({ autoPreview: true });
    await storage.changeRoot(second);

    const manifest = JSON.parse(await readFile(path.join(pointer, "sounddesigner.json"), "utf8"));
    expect(manifest.library.version).toBe(1);
    expect(manifest.preferences.autoPreview).toBe(true);
    expect(storage.root).toBe(second);
  });

  test("imports v1 into application data without changing the original manifest", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, root);
    await writeFile(path.join(root, "sounddesigner.json"), JSON.stringify({ version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", library: { keep: true } }));
    await new StorageService(pointer, root).initialize(root);
    const manifest = JSON.parse(await readFile(path.join(pointer, "sounddesigner.json"), "utf8"));
    expect(manifest.version).toBe(2);
    expect(manifest.library.keep).toBe(true);
    expect(manifest.hostPreferences).toEqual({});
  });

  test("serializes writers from separate host instances", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, root);
    const adobe = new StorageService(pointer, root);
    const resolve = new StorageService(pointer, root);
    await adobe.initialize(root);
    await resolve.initialize(root);
    await Promise.all([adobe.writePreferences({ fromAdobe: true }), resolve.writeLibraryMetadata({ fromResolve: true })]);
    const manifest = JSON.parse(await readFile(path.join(pointer, "sounddesigner.json"), "utf8"));
    expect(manifest.preferences.fromAdobe).toBe(true);
    expect(manifest.libraryMetadata.fromResolve).toBe(true);
  });

  test("recovers a corrupt manifest from backup and clears a stale lock", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, root);
    const storage = new StorageService(pointer, root);
    await storage.initialize(root);
    await storage.writePreferences({ preserved: true });
    const lock = path.join(pointer, ".sounddesigner.lock");
    await writeFile(lock, "stale");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    await storage.writeLibraryMetadata({ afterStaleLock: true });
    await writeFile(path.join(pointer, "sounddesigner.json"), "{broken");
    const recovered = new StorageService(pointer, root);
    await recovered.initialize(root);
    expect(await recovered.readPreferences<{ preserved: boolean }>()).toEqual({ preserved: true });
  });

  test("times out without stealing a live lock", async () => {
    const pointer = await mkdtemp(path.join(tmpdir(), "sounddesigner-pointer-"));
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-root-"));
    roots.push(pointer, root);
    const storage = new StorageService(pointer, root);
    await storage.initialize(root);
    const lock = path.join(pointer, ".sounddesigner.lock");
    await writeFile(lock, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await expect(storage.writePreferences({ blocked: true })).rejects.toThrow("busy in another host");
    expect(await readFile(lock, "utf8")).toContain(String(process.pid));
  }, 15_000);

  test("switches future audio without copying existing media or adopting destination settings", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "sounddesigner-switch-"));
    roots.push(fixture);
    const pointer = path.join(fixture, "app-data");
    const first = path.join(fixture, "first");
    const second = path.join(fixture, "second");
    const storage = new StorageService(pointer, first);
    await storage.initialize(first);
    await storage.writePreferences({ keep: true });
    const source = path.join(first, "old.wav");
    await writeFile(source, Buffer.from([0, 1, 254, 255]));
    await mkdir(second);
    await writeFile(path.join(second, "sounddesigner.json"), JSON.stringify({ version: 2, createdAt: "2026-01-01", preferences: { keep: false } }));
    await storage.changeRoot(second);
    expect(await storage.readPreferences()).toEqual({ keep: true });
    expect(await readFile(source)).toEqual(Buffer.from([0, 1, 254, 255]));
    expect(await readFile(path.join(second, "old.wav")).catch(() => null)).toBeNull();
    const reopened = new StorageService(pointer, first);
    await reopened.initialize();
    expect(reopened.root).toBe(second);
    expect(await reopened.readPreferences()).toEqual({ keep: true });
  });
});
