import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { LibraryService } from "../../src/main/services/libraryService";
import { StorageService } from "../../src/main/services/storageService";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-library-"));
  const storage = await mkdtemp(path.join(tmpdir(), "sounddesigner-library-state-"));
  tempRoots.push(root, storage);
  await mkdir(path.join(root, "Ambience", "Rain"), { recursive: true });
  await mkdir(path.join(root, "Foley"), { recursive: true });
  await writeFile(path.join(root, "Ambience", "Rain", "City Rain.wav"), Buffer.alloc(320));
  await writeFile(path.join(root, "Ambience", "Room Tone.flac"), Buffer.alloc(640));
  await writeFile(path.join(root, "Foley", "Cloth Fast.aiff"), Buffer.alloc(128));
  await writeFile(path.join(root, "notes.txt"), "not an audio file");
  const state = new StorageService(storage, storage);
  await state.initialize(storage);
  return { root, storage, state };
};

describe("local library service", () => {
  test("a disappearing or unreadable subfolder cannot silently prune the previous index", async () => {
    const { root, state } = await fixture();
    const service = new LibraryService(state);
    const initial = await service.addFolder(root);
    let removed = false;
    await expect(service.rescan(undefined, () => {
      if (!removed) { removed = true; rmSync(path.join(root, "Ambience"), { recursive: true }); }
    })).rejects.toThrow("previous index has been preserved");
    expect(await service.getSnapshot()).toEqual(initial);
  });
  test("a scan cannot overwrite library changes made by another instance", async () => {
    const { root, state } = await fixture();
    const first = new LibraryService(state);
    const initial = await first.addFolder(root);
    let changed: Promise<void> | undefined;
    const scan = first.rescan(undefined, () => {
      changed ??= state.writeLibrary({ version: 1, snapshot: { ...initial, folders: [], sounds: [] }, soundMetadata: {}, folderMetadata: {} });
    });
    await expect(scan).rejects.toThrow("changed in another window");
    await changed;
    expect((await new LibraryService(state).getSnapshot()).folders).toHaveLength(0);
  });
  test("same-instance metadata mutations are serialized without losing either edit", async () => {
    const { root, state } = await fixture();
    const service = new LibraryService(state);
    const initial = await service.addFolder(root);
    const sound = initial.sounds[0];
    await Promise.all([service.setSoundFavorite(sound.id, true), service.setSoundLabel(sound.id, "blue")]);
    const restored = await new LibraryService(state).getSnapshot();
    expect(restored.sounds.find(item => item.id === sound.id)).toMatchObject({ favorite: true, labelColor: "blue" });
  });
  test("does not turn a storage read failure into an empty library", async () => {
    let writes = 0;
    const storage = {
      readLibrary: async () => { throw new Error("Storage unavailable"); },
      writeLibrary: async () => { writes++; },
    } as unknown as StorageService;
    const service = new LibraryService(storage);
    await expect(service.getSnapshot()).rejects.toThrow("Storage unavailable");
    await expect(service.removeFolder("existing")).rejects.toThrow("Storage unavailable");
    expect(writes).toBe(0);
  });
  test("recursively indexes supported audio and preserves the folder hierarchy", async () => {
    const { root, state } = await fixture();
    const progress: number[] = [];
    const snapshot = await new LibraryService(state).addFolder(root, (value) => progress.push(value.files));

    expect(snapshot.folders).toHaveLength(1);
    expect(snapshot.sounds).toHaveLength(3);
    expect(snapshot.sounds.some((sound) => sound.path.endsWith("notes.txt"))).toBe(false);
    expect(snapshot.folders[0].tree.totalFileCount).toBe(3);
    expect(snapshot.folders[0].tree.children.map((node) => node.name)).toEqual(["Ambience", "Foley"]);
    expect(snapshot.folders[0].tree.children[0].children[0].name).toBe("Rain");
    expect(snapshot.sounds.find((sound) => sound.name === "City Rain")?.tags).toEqual(["city", "rain"]);
    expect(snapshot.sounds[0].waveform).toHaveLength(72);
    expect(progress.at(-1)).toBe(3);
  });

  test("persists favorites and pinned folders across service instances", async () => {
    const { root, state } = await fixture();
    const firstService = new LibraryService(state);
    let snapshot = await firstService.addFolder(root);
    const sound = snapshot.sounds.find((candidate) => candidate.name === "City Rain")!;
    const ambience = snapshot.folders[0].tree.children.find((node) => node.name === "Ambience")!;

    snapshot = await firstService.setSoundFavorite(sound.id, true);
    snapshot = await firstService.setFolderPinned(ambience.id, true);
    const restored = await new LibraryService(state).getSnapshot();

    expect(restored.sounds.find((candidate) => candidate.id === sound.id)?.favorite).toBe(true);
    expect(restored.folders[0].tree.children.find((node) => node.id === ambience.id)?.pinned).toBe(true);
    expect(snapshot.updatedAt).toBeGreaterThan(0);
  });

  test("rescans changed folders and removes only the index entry", async () => {
    const { root, state } = await fixture();
    const service = new LibraryService(state);
    let snapshot = await service.addFolder(root);
    const folderId = snapshot.folders[0].id;
    await rm(path.join(root, "Foley", "Cloth Fast.aiff"));
    await writeFile(path.join(root, "Foley", "Footstep.wav"), Buffer.alloc(256));

    snapshot = await service.rescan(folderId);
    expect(snapshot.sounds.some((sound) => sound.name === "Cloth Fast")).toBe(false);
    expect(snapshot.sounds.some((sound) => sound.name === "Footstep")).toBe(true);

    snapshot = await service.removeFolder(folderId);
    expect(snapshot.folders).toHaveLength(0);
    expect(snapshot.sounds).toHaveLength(0);
    expect(await Bun.file(path.join(root, "Foley", "Footstep.wav")).exists()).toBe(true);
  });

  test("cancels an active scan without saving a partial library", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sounddesigner-library-large-"));
    const storage = await mkdtemp(path.join(tmpdir(), "sounddesigner-library-state-"));
    tempRoots.push(root, storage);
    await Promise.all(Array.from({ length: 420 }, (_, index) =>
      writeFile(path.join(root, `fixture-${index}.wav`), Buffer.alloc(32))));
    const state = new StorageService(storage, storage);
    await state.initialize(storage);
    const service = new LibraryService(state);

    const scan = service.addFolder(root);
    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(service.cancelScan()).toBe(true);
    await expect(scan).rejects.toMatchObject({ code: "LIBRARY_SCAN_CANCELLED" });
    expect(await new LibraryService(state).getSnapshot()).toEqual({ folders: [], sounds: [], updatedAt: 0 });
  });

  test("rolls back a scan cancelled after its final progress update", async () => {
    const { root, state } = await fixture();
    const service = new LibraryService(state);
    let cancelled = false;

    const scan = service.addFolder(root, (progress) => {
      if (!cancelled && progress.files === 3) {
        cancelled = service.cancelScan();
      }
    });

    await expect(scan).rejects.toMatchObject({ code: "LIBRARY_SCAN_CANCELLED" });
    expect(cancelled).toBe(true);
    expect(await service.getSnapshot()).toEqual({ folders: [], sounds: [], updatedAt: 0 });
    expect(await new LibraryService(state).getSnapshot()).toEqual({ folders: [], sounds: [], updatedAt: 0 });
  });
});
