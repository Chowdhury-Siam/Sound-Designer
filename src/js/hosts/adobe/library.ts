import { path } from "../../lib/cep/node";
import { nativePathKey } from "../../platform/nativePaths";
import { chooseLibraryFolder, loadLibraryPaths, nextAccent, scanFolder } from "../../main/library";
import type { LabelColor, LibraryFolder, LibraryTreeNode, SoundFile } from "../../main/types";
import type { PlatformLibrarySnapshot } from "../../platform/types";
import type { AdobeStorageService } from "./storage";

type SoundMetadata = { favorite?: boolean; labelColor?: LabelColor };
type FolderMetadata = { pinned?: boolean; labelColor?: LabelColor };
type StoredSound = Omit<SoundFile, "waveform" | "accent"> & { waveform: number[] };
type LibraryDocument = {
  version: 1;
  snapshot: { folders: Omit<LibraryFolder, "accent">[]; sounds: StoredSound[]; updatedAt: number };
  soundMetadata: Record<string, SoundMetadata>;
  folderMetadata: Record<string, FolderMetadata>;
};

const emptyDocument = (): LibraryDocument => ({
  version: 1,
  snapshot: { folders: [], sounds: [], updatedAt: 0 },
  soundMetadata: {},
  folderMetadata: {},
});

const nativeKey = (value: string) => {
  return nativePathKey(path.resolve(value), path.sep === "\\");
};

const findNode = (nodes: LibraryTreeNode[], id: string): LibraryTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNode(node.children, id);
    if (child) return child;
  }
  return null;
};

export class AdobeLibraryService {
  private document = emptyDocument();
  private baseline = "null";
  private operations: Promise<unknown> = Promise.resolve();

  constructor(private readonly storage: AdobeStorageService) {}

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.operations.then(operation);
    this.operations = pending.catch(() => {});
    return pending;
  }

  private async load(): Promise<void> {
    const parsed = await this.storage.getLibrary<Partial<LibraryDocument>>();
    this.baseline = JSON.stringify(parsed ?? null);
    if (parsed && (parsed.version !== 1 || !parsed.snapshot)) throw new Error("The SoundDesigner library index is invalid. Restore a valid backup before changing it.");
    if (parsed?.version === 1 && parsed.snapshot) {
      this.document = {
        version: 1,
        snapshot: {
          folders: Array.isArray(parsed.snapshot.folders) ? parsed.snapshot.folders : [],
          sounds: Array.isArray(parsed.snapshot.sounds) ? parsed.snapshot.sounds : [],
          updatedAt: Number(parsed.snapshot.updatedAt) || 0,
        },
        soundMetadata: Object.fromEntries(Object.entries(parsed.soundMetadata || {}).map(([key, entry]) => [nativeKey(key), entry])),
        folderMetadata: Object.fromEntries(Object.entries(parsed.folderMetadata || {}).map(([key, entry]) => [nativeKey(key), entry])),
      };
      return;
    }

    this.document = emptyDocument();
    const legacyPaths = loadLibraryPaths();
    if (!legacyPaths.length) return;
    for (let index = 0; index < legacyPaths.length; index += 1) {
      try { await this.replaceFolder(legacyPaths[index], index); } catch (_error) {}
    }
    if (this.document.snapshot.folders.length) await this.save();
  }

  private hydrate(folder: LibraryFolder, sounds: SoundFile[]): void {
    const hydrateNode = (node: LibraryTreeNode) => {
      const metadata = this.document.folderMetadata[nativeKey(node.path)];
      node.pinned = metadata?.pinned === true;
      node.labelColor = metadata?.labelColor;
      node.children.forEach(hydrateNode);
    };
    hydrateNode(folder.tree);
    for (const sound of sounds) {
      const metadata = this.document.soundMetadata[nativeKey(sound.path)];
      sound.favorite = metadata?.favorite === true;
      sound.labelColor = metadata?.labelColor;
    }
  }

  private snapshot(): PlatformLibrarySnapshot {
    return {
      folders: this.document.snapshot.folders.map((folder) => ({ ...folder, accent: "graphite" })),
      sounds: this.document.snapshot.sounds.map((sound) => ({
        ...sound,
        waveform: new Float32Array(Array.isArray(sound.waveform) ? sound.waveform : []),
        accent: "graphite",
        source: "local",
      })),
      updatedAt: this.document.snapshot.updatedAt,
    };
  }

  private async save(): Promise<void> {
    const serialized = JSON.stringify(this.document);
    await this.storage.saveLibrary(this.document, this.baseline);
    this.baseline = serialized;
  }

  private async replaceFolder(folderPath: string, accentIndex: number): Promise<void> {
    const scanned = await scanFolder(folderPath, nextAccent(accentIndex));
    if (scanned.diagnostics.unreadableDirectories) throw new Error("A library folder could not be read. The previous index has been preserved; check the disk and folder permissions before rescanning.");
    this.hydrate(scanned.folder, scanned.sounds);
    const existing = this.document.snapshot.folders.find((folder) => nativeKey(folder.path) === nativeKey(folderPath));
    const { accent: _folderAccent, ...storedFolder } = scanned.folder;
    this.document.snapshot.folders = [
      ...this.document.snapshot.folders.filter((folder) => folder.id !== existing?.id),
      storedFolder,
    ].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: "base" }));
    this.document.snapshot.sounds = [
      ...this.document.snapshot.sounds.filter((sound) => sound.folderId !== existing?.id),
      ...scanned.sounds.map(({ waveform, accent: _accent, ...sound }) => ({ ...sound, waveform: Array.from(waveform) })),
    ];
    this.document.snapshot.updatedAt = Date.now();
  }

  async getSnapshot(): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      return this.snapshot();
    });
  }

  async addFolder(): Promise<PlatformLibrarySnapshot | null> {
    return this.exclusive(async () => {
      const folderPath = chooseLibraryFolder();
      if (!folderPath) return null;
      await this.load();
      await this.replaceFolder(folderPath, this.document.snapshot.folders.length);
      await this.save();
      return this.snapshot();
    });
  }

  async rescan(folderId?: string): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      const folders = folderId
        ? this.document.snapshot.folders.filter((folder) => folder.id === folderId)
        : [...this.document.snapshot.folders];
      if (folderId && !folders.length) throw new Error("The selected library folder no longer exists.");
      for (let index = 0; index < folders.length; index += 1) await this.replaceFolder(folders[index].path, index);
      await this.save();
      return this.snapshot();
    });
  }

  async removeFolder(folderId: string): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      if (!this.document.snapshot.folders.some((folder) => folder.id === folderId)) throw new Error("The selected library folder no longer exists.");
      this.document.snapshot.folders = this.document.snapshot.folders.filter((folder) => folder.id !== folderId);
      this.document.snapshot.sounds = this.document.snapshot.sounds.filter((sound) => sound.folderId !== folderId);
      this.document.snapshot.updatedAt = Date.now();
      await this.save();
      return this.snapshot();
    });
  }

  async setSoundFavorite(soundId: string, favorite: boolean): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      const sound = this.document.snapshot.sounds.find((candidate) => candidate.id === soundId);
      if (!sound) throw new Error("The selected sound no longer exists in the library index.");
      sound.favorite = favorite;
      const key = nativeKey(sound.path);
      this.document.soundMetadata[key] = { ...this.document.soundMetadata[key], favorite };
      return this.finishMutation();
    });
  }

  async setFolderPinned(nodeId: string, pinned: boolean): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      const node = findNode(this.document.snapshot.folders.map((folder) => folder.tree), nodeId);
      if (!node) throw new Error("The selected library folder no longer exists.");
      node.pinned = pinned;
      const key = nativeKey(node.path);
      this.document.folderMetadata[key] = { ...this.document.folderMetadata[key], pinned };
      return this.finishMutation();
    });
  }

  async setSoundLabel(soundId: string, labelColor?: LabelColor): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      const sound = this.document.snapshot.sounds.find((candidate) => candidate.id === soundId);
      if (!sound) throw new Error("The selected sound no longer exists in the library index.");
      sound.labelColor = labelColor;
      const key = nativeKey(sound.path);
      this.document.soundMetadata[key] = { ...this.document.soundMetadata[key], labelColor };
      return this.finishMutation();
    });
  }

  async setFolderLabel(nodeId: string, labelColor?: LabelColor): Promise<PlatformLibrarySnapshot> {
    return this.exclusive(async () => {
      await this.load();
      const node = findNode(this.document.snapshot.folders.map((folder) => folder.tree), nodeId);
      if (!node) throw new Error("The selected library folder no longer exists.");
      node.labelColor = labelColor;
      const key = nativeKey(node.path);
      this.document.folderMetadata[key] = { ...this.document.folderMetadata[key], labelColor };
      return this.finishMutation();
    });
  }

  private async finishMutation(): Promise<PlatformLibrarySnapshot> {
    this.document.snapshot.updatedAt = Date.now();
    await this.save();
    return this.snapshot();
  }
}
