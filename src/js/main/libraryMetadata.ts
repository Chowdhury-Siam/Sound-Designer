import { isCloudSound } from "./cloudLibrary";
import { fs, path } from "../lib/cep/node";
import { csi } from "../lib/utils/bolt";
import { normalizeDialogPath } from "./library";
import type { LabelColor, LibraryFolder, LibraryTreeNode, SoundFile } from "./types";
import { platform } from "../platform/client";
import { nativePathKey } from "../platform/nativePaths";

type SoundMetadata = {
  favoriteCollection?: string;
  cloudSound?: Omit<SoundFile, "waveform">;
  labelColor?: LabelColor;
  favorite?: boolean;
  waveformFingerprint?: string;
  waveform?: number[];
};

type FolderMetadata = {
  labelColor?: LabelColor;
  pinned?: boolean;
};

type MetadataDocument = {
  collections?: FavoriteCollection[];
  version: 1;
  sounds: Record<string, SoundMetadata>;
  folders: Record<string, FolderMetadata>;
  updatedAt: number;
};

export type FavoriteCollection = { id: string; name: string; parentId: string };
export const loadFavoriteCollections = (): FavoriteCollection[] => {
  const list = loadDocument().collections;
  return Array.isArray(list) ? list.filter(item => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.parentId === "string") : [];
};
export const saveFavoriteCollections = (collections: FavoriteCollection[]) => {
  loadDocument().collections = collections;
  scheduleSave();
};
export const loadCloudFavorites = (): SoundFile[] => Object.values(loadDocument().sounds)
  .filter(item => item.favorite && item.cloudSound)
  .map(item => ({ ...item.cloudSound!, favorite: true, favoriteCollection: item.favoriteCollection || "", waveform: new Float32Array(0), waveformReal: false }));

const STORAGE_DIRECTORY = "SoundDesigner";
const STORAGE_FILE = "library-metadata.json";
const BROWSER_KEY = "sounddesigner.library-metadata.v1";
const LEGACY_KEY = "sounddesigner.resolve.library-metadata.v1";
const MIGRATION_KEY = "sounddesigner.resolve.library-metadata-migrated.v1";
const EMPTY_DOCUMENT = (): MetadataDocument => ({ version: 1, sounds: {}, folders: {}, updatedAt: 0 });
let documentCache: MetadataDocument | null = null;
let saveTimer = 0;
let metadataDirty = false;
let legacyDocument: MetadataDocument | null = null;

const nativeKey = (nativePath: string) => {
  const normalized = normalizeDialogPath(nativePath);
  return nativePathKey(normalized, Boolean(path && path.sep === "\\") || /^[A-Za-z]:[\\/]|^\\\\/.test(normalized));
};

const soundKey = (sound: Pick<SoundFile, "path" | "source" | "sourceId" | "id">) =>
  isCloudSound(sound)
    ? `source:${sound.source}:${sound.sourceId || sound.id}`
    : sound.path ? `file:${nativeKey(sound.path)}` : `source:${sound.source || "local"}:${sound.sourceId || sound.id}`;

const waveformFingerprint = (sound: Pick<SoundFile, "path" | "size" | "modifiedAt">) =>
  `${nativeKey(sound.path)}:${Number(sound.size) || 0}:${Number(sound.modifiedAt) || 0}`;

const metadataPath = () => {
  if (!window.cep || !fs || !path || typeof csi.getSystemPath !== "function") return "";
  try {
    const userData = csi.getSystemPath("userData");
    return userData ? path.join(userData, STORAGE_DIRECTORY, STORAGE_FILE) : "";
  } catch (_error) {
    return "";
  }
};

const sanitizeDocument = (value: unknown): MetadataDocument => {
  if (!value || typeof value !== "object") return EMPTY_DOCUMENT();
  const candidate = value as Partial<MetadataDocument>;
  const sounds: Record<string, SoundMetadata> = {};
  for (const [key, entry] of Object.entries(candidate.sounds || {})) {
    const canonical = key.startsWith("file:") ? `file:${nativeKey(key.slice(5))}`
      : /^(scorpion|freesound):/.test(key) ? `source:${key}` : key;
    sounds[canonical] = { ...sounds[canonical], ...entry, ...(canonical !== key ? candidate.sounds?.[canonical] : {}) };
    if (sounds[canonical].waveformFingerprint) sounds[canonical].waveformFingerprint = sounds[canonical].waveformFingerprint!.normalize("NFC");
  }
  return {
    version: 1,
    sounds,
    folders: candidate.folders && typeof candidate.folders === "object"
      ? Object.fromEntries(Object.entries(candidate.folders).map(([key, entry]) => [nativeKey(key), entry])) : {},
    collections: candidate.collections,
    updatedAt: Number(candidate.updatedAt) || 0,
  };
};

const loadDocument = () => {
  if (documentCache) return documentCache;
  const filePath = metadataPath();
  try {
    if (filePath && typeof fs.existsSync === "function" && fs.existsSync(filePath)) {
      documentCache = sanitizeDocument(JSON.parse(fs.readFileSync(filePath, "utf8")));
      return documentCache;
    }
  } catch (_error) {}
  try {
    documentCache = sanitizeDocument(JSON.parse(localStorage.getItem(BROWSER_KEY) || "null"));
  } catch (_error) {
    documentCache = EMPTY_DOCUMENT();
  }
  if (platform().mode === "resolve") {
    try {
      if (!localStorage.getItem(MIGRATION_KEY) && localStorage.getItem(LEGACY_KEY)) {
        legacyDocument = sanitizeDocument(JSON.parse(localStorage.getItem(LEGACY_KEY)!));
        documentCache = {
          ...documentCache,
          sounds: { ...legacyDocument.sounds, ...documentCache.sounds },
          folders: { ...legacyDocument.folders, ...documentCache.folders },
          collections: documentCache.collections || legacyDocument.collections,
        };
      }
    } catch (_error) { /* Keep malformed legacy data untouched. */ }
  }
  return documentCache;
};

export const flushLibraryMetadata = () => {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  if (!documentCache || !metadataDirty) return;
  metadataDirty = false;
  documentCache.updatedAt = Date.now();
  const serialized = JSON.stringify(documentCache);
  if (platform().capabilities.nativeStorage) void platform().storage.saveLibraryMetadata(documentCache);
  const filePath = metadataPath();
  if (filePath && typeof fs.writeFileSync === "function") {
    const directory = path.dirname(filePath);
    const temporary = `${filePath}.tmp`;
    try {
      if (!fs.existsSync(directory)) fs.mkdirSync(directory);
      fs.writeFileSync(temporary, serialized, "utf8");
      try {
        fs.renameSync(temporary, filePath);
      } catch (_renameError) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        fs.renameSync(temporary, filePath);
      }
      return;
    } catch (_error) {
      try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (_cleanupError) {}
    }
  }
  try { localStorage.setItem(BROWSER_KEY, serialized); } catch (_error) {}
};

export const loadPortableLibraryMetadata = async () => {
  if (!platform().capabilities.nativeStorage) return;
  if (metadataDirty) return;
  const local = loadDocument();
  const result = await platform().storage.getLibraryMetadata();
  if (!result.ok || metadataDirty) return;
  if (result.data) {
    const portable = sanitizeDocument(result.data);
    if (legacyDocument) {
      portable.sounds = { ...legacyDocument.sounds, ...portable.sounds };
      portable.folders = { ...legacyDocument.folders, ...portable.folders };
      portable.collections = [...new Map([...(legacyDocument.collections || []), ...(portable.collections || [])].map(item => [item.id, item])).values()];
    }
    for (const [key, entry] of Object.entries(local.sounds)) {
      if (!entry.waveform?.length) continue;
      portable.sounds[key] = { ...portable.sounds[key], waveform: entry.waveform, waveformFingerprint: entry.waveformFingerprint };
    }
    documentCache = portable;
  }
  const rawSounds = (result.data as Partial<MetadataDocument> | null)?.sounds || {};
  if (!result.data || legacyDocument || Object.keys(rawSounds).some(key => /^(scorpion|freesound):/.test(key))) {
    const saved = await platform().storage.saveLibraryMetadata(documentCache!);
    if (!saved.ok) return;
    if (legacyDocument) {
      try { localStorage.setItem(MIGRATION_KEY, "true"); } catch (_error) {}
      legacyDocument = null;
    }
  }
  try { localStorage.setItem(BROWSER_KEY, JSON.stringify(documentCache)); } catch (_error) {}
};

const scheduleSave = () => {
  metadataDirty = true;
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushLibraryMetadata, 700);
};

const hydrateNode = (node: LibraryTreeNode): LibraryTreeNode => {
  const stored = loadDocument().folders[nativeKey(node.path)];
  return {
    ...node,
    labelColor: stored ? stored.labelColor : node.labelColor,
    pinned: stored ? stored.pinned === true : node.pinned,
    children: node.children.map(hydrateNode),
  };
};

export const hydrateLibraryMetadata = (folders: LibraryFolder[], sounds: SoundFile[]) => ({
  folders: folders.map((folder) => ({ ...folder, tree: hydrateNode(folder.tree) })),
  sounds: sounds.map((sound) => {
    const stored = loadDocument().sounds[soundKey(sound)];
    const cachedWaveform = stored?.waveformFingerprint === waveformFingerprint(sound)
      && Array.isArray(stored.waveform)
      && stored.waveform.length > 1
      ? Float32Array.from(stored.waveform.map((value) => Math.max(0, Math.min(1, Number(value) || 0))))
      : null;
    return {
      ...sound,
      favorite: typeof stored?.favorite === "boolean" ? stored.favorite : sound.favorite,
      favoriteCollection: stored?.favoriteCollection || "",
      labelColor: stored ? stored.labelColor : sound.labelColor,
      waveform: cachedWaveform || sound.waveform,
      waveformReal: Boolean(cachedWaveform) || sound.waveformReal === true,
    };
  }),
});

export const saveSoundMetadata = (
  sound: SoundFile,
  patch: { labelColor?: LabelColor; favorite?: boolean; favoriteCollection?: string; waveform?: Float32Array; clearLabel?: boolean },
) => {
  const cache = loadDocument();
  const key = soundKey(sound);
  const current = cache.sounds[key] || {};
  if (patch.clearLabel) delete current.labelColor;
  else if (patch.labelColor) current.labelColor = patch.labelColor;
  if (typeof patch.favorite === "boolean") current.favorite = patch.favorite;
  if (typeof patch.favoriteCollection === "string") current.favoriteCollection = patch.favoriteCollection;
  if (isCloudSound(sound) && current.favorite) {
    const { waveform, ...snapshot } = sound;
    current.cloudSound = snapshot;
  }
  if (patch.waveform && sound.path) {
    current.waveformFingerprint = waveformFingerprint(sound);
    current.waveform = Array.from(patch.waveform, (value) => Math.round(Math.max(0, Math.min(1, value)) * 255) / 255);
  }
  cache.sounds[key] = current;
  scheduleSave();
};

export const saveFolderMetadata = (
  folderPath: string,
  patch: { labelColor?: LabelColor; pinned?: boolean; clearLabel?: boolean },
) => {
  const cache = loadDocument();
  const key = nativeKey(folderPath);
  const current = cache.folders[key] || {};
  if (patch.clearLabel) delete current.labelColor;
  else if (patch.labelColor) current.labelColor = patch.labelColor;
  if (typeof patch.pinned === "boolean") current.pinned = patch.pinned;
  cache.folders[key] = current;
  scheduleSave();
};
