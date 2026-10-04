import path from "node:path";
import { nativePathKey } from "../../../../src/js/platform/nativePaths";
import { readdir, realpath, stat } from "node:fs/promises";
import type {
  LibraryFolder,
  LibraryScanProgress,
  LibrarySnapshot,
  LibrarySound,
  LibraryTreeNode,
} from "../../shared/types";
import { ResolveHostError } from "./resolveHost";
import type { StorageService } from "./storageService";

const AUDIO_EXTENSIONS = new Set([
  "3g2", "3gp", "aac", "ac3", "adts", "aif", "aiff", "amr", "ape", "au", "bwf", "caf", "dts",
  "flac", "m4a", "m4b", "m4r", "mka", "mp2", "mp3", "mpa", "mpc", "oga", "ogg", "opus", "ra",
  "ram", "snd", "spx", "tak", "tta", "voc", "wav", "weba", "webm", "wma", "wv",
]);

type SoundMetadata = { favorite?: boolean; labelColor?: LibrarySound["labelColor"] };
type FolderMetadata = { pinned?: boolean; labelColor?: LibraryTreeNode["labelColor"] };
type LibraryDocument = {
  version: 1;
  snapshot: LibrarySnapshot;
  soundMetadata: Record<string, SoundMetadata>;
  folderMetadata: Record<string, FolderMetadata>;
};

type ProgressListener = (progress: LibraryScanProgress) => void;

const emptySnapshot = (): LibrarySnapshot => ({ folders: [], sounds: [], updatedAt: 0 });
const emptyDocument = (): LibraryDocument => ({
  version: 1,
  snapshot: emptySnapshot(),
  soundMetadata: {},
  folderMetadata: {},
});

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
};

const nativeKey = (value: string): string => {
  return nativePathKey(path.resolve(value), process.platform === "win32");
};

const extensionFromPath = (filePath: string): string => path.extname(filePath).slice(1).toLocaleLowerCase("en-US");

const waveformForPath = (filePath: string, bars = 72): number[] => {
  let value = hashString(nativeKey(filePath)) || 1;
  return Array.from({ length: bars }, (_, index) => {
    value = (value * 1664525 + 1013904223) >>> 0;
    const noise = (value % 1000) / 1000;
    const envelope = 0.44 + Math.sin((index / bars) * Math.PI) * 0.56;
    return Math.max(0.12, Math.min(1, (0.2 + noise * 0.8) * envelope));
  });
};

const tagsForName = (name: string): string[] => name
  .toLocaleLowerCase("en-US")
  .split(/[\s_\-.]+/)
  .filter((part) => part.length > 1)
  .slice(0, 8);

const createTreeNode = (rootId: string, name: string, nodePath: string, root = false): LibraryTreeNode => ({
  id: root ? rootId : `directory-${hashString(nativeKey(nodePath))}`,
  rootId,
  name,
  path: nodePath,
  directFileCount: 0,
  totalFileCount: 0,
  children: [],
});

const finalizeTree = (node: LibraryTreeNode): number => {
  node.children.sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: "base" }));
  let total = node.directFileCount;
  for (const child of node.children) total += finalizeTree(child);
  node.totalFileCount = total;
  return total;
};

const findTreeNode = (nodes: LibraryTreeNode[], id: string): LibraryTreeNode | null => {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findTreeNode(node.children, id);
    if (child) return child;
  }
  return null;
};

const assertNotAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new ResolveHostError("LIBRARY_SCAN_CANCELLED", "Library indexing was cancelled.");
};

export class LibraryService {
  private document: LibraryDocument = emptyDocument();
  private loaded = false;
  private scanController: AbortController | null = null;

  constructor(private readonly storage: StorageService) {}

  private async load(force = false): Promise<void> {
    if (this.loaded && !force) return;
    this.loaded = true;
    this.document = emptyDocument();
    try {
      const parsed = await this.storage.readLibrary<Partial<LibraryDocument>>();
      if (!parsed) return;
      if (parsed.version !== 1 || !parsed.snapshot) return;
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
    } catch {
      this.document = emptyDocument();
    }
  }

  private async save(): Promise<void> {
    await this.storage.writeLibrary(this.document);
  }

  private hydrateMetadata(folder: LibraryFolder, sounds: LibrarySound[]): void {
    const hydrateNode = (node: LibraryTreeNode): void => {
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

  private async scanFolder(
    folderPath: string,
    operationId: string,
    signal: AbortSignal,
    onProgress?: ProgressListener,
  ): Promise<{ folder: LibraryFolder; sounds: LibrarySound[] }> {
    const rootPath = path.resolve(folderPath);
    const rootDetails = await stat(rootPath).catch(() => null);
    if (!rootDetails?.isDirectory()) {
      throw new ResolveHostError("LIBRARY_FOLDER_UNAVAILABLE", "The selected sound-library folder is unavailable.");
    }

    const rootId = `folder-${hashString(nativeKey(rootPath))}`;
    const tree = createTreeNode(rootId, path.basename(rootPath) || rootPath, rootPath, true);
    const folder: LibraryFolder = {
      id: rootId,
      name: tree.name,
      path: rootPath,
      fileCount: 0,
      indexedAt: Date.now(),
      tree,
    };
    const sounds: LibrarySound[] = [];
    const queue: Array<{ directoryPath: string; node: LibraryTreeNode }> = [{ directoryPath: rootPath, node: tree }];
    const visited = new Set<string>();
    let queueIndex = 0;
    let processedEntries = 0;

    while (queueIndex < queue.length) {
      assertNotAborted(signal);
      const current = queue[queueIndex++];
      const canonical = nativeKey(await realpath(current.directoryPath).catch(() => current.directoryPath));
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      if (visited.size > 100000) {
        throw new ResolveHostError("LIBRARY_TOO_LARGE", "The library contains too many linked directories to scan safely.");
      }

      const entries = await readdir(current.directoryPath, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        assertNotAborted(signal);
        const entryPath = path.join(current.directoryPath, entry.name);
        let isDirectory = entry.isDirectory();
        let isFile = entry.isFile();
        let details = null;
        if (entry.isSymbolicLink() || (!isDirectory && !isFile)) {
          details = await stat(entryPath).catch(() => null);
          isDirectory = details?.isDirectory() === true;
          isFile = details?.isFile() === true;
        }
        if (isDirectory) {
          const child = createTreeNode(rootId, entry.name, entryPath);
          current.node.children.push(child);
          queue.push({ directoryPath: entryPath, node: child });
        } else if (isFile) {
          const extension = extensionFromPath(entryPath);
          if (!AUDIO_EXTENSIONS.has(extension)) continue;
          details ??= await stat(entryPath).catch(() => null);
          const name = path.basename(entry.name, path.extname(entry.name));
          const sound: LibrarySound = {
            id: `file-${hashString(nativeKey(entryPath))}`,
            folderId: rootId,
            directoryId: current.node.id,
            name,
            path: entryPath,
            extension,
            size: Number(details?.size) || 0,
            modifiedAt: Number(details?.mtimeMs) || 0,
            duration: 0,
            tags: tagsForName(name),
            waveform: waveformForPath(entryPath),
          };
          sounds.push(sound);
          current.node.directFileCount += 1;
        }

        processedEntries += 1;
        if (processedEntries % 192 === 0) {
          onProgress?.({
            operationId,
            files: sounds.length,
            folders: visited.size + queue.length - queueIndex,
            currentPath: current.directoryPath,
          });
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }
      onProgress?.({
        operationId,
        files: sounds.length,
        folders: visited.size + queue.length - queueIndex,
        currentPath: current.directoryPath,
      });
    }

    folder.fileCount = finalizeTree(tree);
    this.hydrateMetadata(folder, sounds);
    return { folder, sounds };
  }

  async getSnapshot(): Promise<LibrarySnapshot> {
    await this.load(this.scanController === null);
    return structuredClone(this.document.snapshot);
  }

  private async replaceScannedFolder(
    folderPath: string,
    operationId: string,
    signal: AbortSignal,
    onProgress?: ProgressListener,
  ): Promise<void> {
    const scanned = await this.scanFolder(folderPath, operationId, signal, onProgress);
    const oldFolder = this.document.snapshot.folders.find((folder) => nativeKey(folder.path) === nativeKey(folderPath));
    this.document.snapshot.folders = [
      ...this.document.snapshot.folders.filter((folder) => folder.id !== oldFolder?.id),
      scanned.folder,
    ].sort((first, second) => first.name.localeCompare(second.name, undefined, { sensitivity: "base" }));
    this.document.snapshot.sounds = [
      ...this.document.snapshot.sounds.filter((sound) => sound.folderId !== oldFolder?.id),
      ...scanned.sounds,
    ];
    this.document.snapshot.updatedAt = Date.now();
  }

  private async runScan(operation: (operationId: string, signal: AbortSignal) => Promise<void>): Promise<LibrarySnapshot> {
    this.scanController?.abort();
    const controller = new AbortController();
    this.scanController = controller;
    const operationId = `scan-${Date.now()}-${Math.round(Math.random() * 100000)}`;
    let previousDocument: LibraryDocument | null = null;
    try {
      await this.load(true);
      assertNotAborted(controller.signal);
      previousDocument = structuredClone(this.document);
      await operation(operationId, controller.signal);
      assertNotAborted(controller.signal);
      await this.save();
      return structuredClone(this.document.snapshot);
    } catch (error) {
      if (previousDocument) this.document = previousDocument;
      throw error;
    } finally {
      if (this.scanController === controller) this.scanController = null;
    }
  }

  async addFolder(folderPath: string, onProgress?: ProgressListener): Promise<LibrarySnapshot> {
    return this.runScan(async (operationId, signal) => {
      await this.replaceScannedFolder(folderPath, operationId, signal, onProgress);
    });
  }

  async rescan(folderId: string | undefined, onProgress?: ProgressListener): Promise<LibrarySnapshot> {
    return this.runScan(async (operationId, signal) => {
      const folders = folderId
        ? this.document.snapshot.folders.filter((folder) => folder.id === folderId)
        : [...this.document.snapshot.folders];
      if (folderId && !folders.length) throw new ResolveHostError("LIBRARY_FOLDER_UNKNOWN", "The selected library folder no longer exists.");
      for (const folder of folders) {
        assertNotAborted(signal);
        await this.replaceScannedFolder(folder.path, operationId, signal, onProgress);
      }
    });
  }

  async removeFolder(folderId: string): Promise<LibrarySnapshot> {
    await this.load(true);
    const existing = this.document.snapshot.folders.find((folder) => folder.id === folderId);
    if (!existing) throw new ResolveHostError("LIBRARY_FOLDER_UNKNOWN", "The selected library folder no longer exists.");
    this.document.snapshot.folders = this.document.snapshot.folders.filter((folder) => folder.id !== folderId);
    this.document.snapshot.sounds = this.document.snapshot.sounds.filter((sound) => sound.folderId !== folderId);
    this.document.snapshot.updatedAt = Date.now();
    await this.save();
    return structuredClone(this.document.snapshot);
  }

  cancelScan(): boolean {
    if (!this.scanController) return false;
    this.scanController.abort();
    return true;
  }

  async setSoundFavorite(soundId: string, favorite: boolean): Promise<LibrarySnapshot> {
    await this.load(true);
    const sound = this.document.snapshot.sounds.find((candidate) => candidate.id === soundId);
    if (!sound) throw new ResolveHostError("LIBRARY_SOUND_UNKNOWN", "The selected sound no longer exists in the library index.");
    sound.favorite = favorite;
    this.document.soundMetadata[nativeKey(sound.path)] = {
      ...this.document.soundMetadata[nativeKey(sound.path)],
      favorite,
    };
    this.document.snapshot.updatedAt = Date.now();
    await this.save();
    return structuredClone(this.document.snapshot);
  }

  async setFolderPinned(nodeId: string, pinned: boolean): Promise<LibrarySnapshot> {
    await this.load(true);
    const node = findTreeNode(this.document.snapshot.folders.map((folder) => folder.tree), nodeId);
    if (!node) throw new ResolveHostError("LIBRARY_FOLDER_UNKNOWN", "The selected library folder no longer exists.");
    node.pinned = pinned;
    this.document.folderMetadata[nativeKey(node.path)] = {
      ...this.document.folderMetadata[nativeKey(node.path)],
      pinned,
    };
    this.document.snapshot.updatedAt = Date.now();
    await this.save();
    return structuredClone(this.document.snapshot);
  }

  async setSoundLabel(soundId: string, labelColor?: LibrarySound["labelColor"]): Promise<LibrarySnapshot> {
    await this.load(true);
    const sound = this.document.snapshot.sounds.find((candidate) => candidate.id === soundId);
    if (!sound) throw new ResolveHostError("LIBRARY_SOUND_UNKNOWN", "The selected sound no longer exists in the library index.");
    sound.labelColor = labelColor;
    this.document.soundMetadata[nativeKey(sound.path)] = {
      ...this.document.soundMetadata[nativeKey(sound.path)],
      labelColor,
    };
    this.document.snapshot.updatedAt = Date.now();
    await this.save();
    return structuredClone(this.document.snapshot);
  }

  async setFolderLabel(nodeId: string, labelColor?: LibraryTreeNode["labelColor"]): Promise<LibrarySnapshot> {
    await this.load(true);
    const node = findTreeNode(this.document.snapshot.folders.map((folder) => folder.tree), nodeId);
    if (!node) throw new ResolveHostError("LIBRARY_FOLDER_UNKNOWN", "The selected library folder no longer exists.");
    node.labelColor = labelColor;
    this.document.folderMetadata[nativeKey(node.path)] = {
      ...this.document.folderMetadata[nativeKey(node.path)],
      labelColor,
    };
    this.document.snapshot.updatedAt = Date.now();
    await this.save();
    return structuredClone(this.document.snapshot);
  }
}
