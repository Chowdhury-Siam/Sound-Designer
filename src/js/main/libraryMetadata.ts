import { fs, path } from "../lib/cep/node";
import { csi } from "../lib/utils/bolt";
import { normalizeDialogPath } from "./library";
import type { LabelColor, LibraryFolder, LibraryTreeNode, SoundFile } from "./types";

type SoundMetadata = {
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
  version: 1;
  sounds: Record<string, SoundMetadata>;
  folders: Record<string, FolderMetadata>;
  updatedAt: number;
};

const STORAGE_DIRECTORY = "SoundDesigner";
const STORAGE_FILE = "library-metadata.json";
const BROWSER_KEY = "sounddesigner.library-metadata.v1";
const EMPTY_DOCUMENT = (): MetadataDocument => ({ version: 1, sounds: {}, folders: {}, updatedAt: 0 });
let documentCache: MetadataDocument | null = null;
let saveTimer = 0;

const nativeKey = (nativePath: string) => {
  const normalized = normalizeDialogPath(nativePath).replace(/[\\/]+$/, "");
  return path && path.sep === "\\" ? normalized.toLowerCase() : normalized;
};

const soundKey = (sound: Pick<SoundFile, "path" | "source" | "sourceId" | "id">) =>
  sound.source === "freesound"
    ? `source:freesound:${sound.sourceId || sound.id}`
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
  return {
    version: 1,
    sounds: candidate.sounds && typeof candidate.sounds === "object" ? candidate.sounds : {},
    folders: candidate.folders && typeof candidate.folders === "object" ? candidate.folders : {},
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
  return documentCache;
};

export const flushLibraryMetadata = () => {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = 0;
  if (!documentCache) return;
  documentCache.updatedAt = Date.now();
  const serialized = JSON.stringify(documentCache);
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

const scheduleSave = () => {
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushLibraryMetadata, 700);
};

const hydrateNode = (node: LibraryTreeNode): LibraryTreeNode => {
  const stored = loadDocument().folders[nativeKey(node.path)];
  return {
    ...node,
    labelColor: stored?.labelColor,
    pinned: stored?.pinned === true,
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
      favorite: stored?.favorite === true,
      labelColor: stored?.labelColor,
      waveform: cachedWaveform || sound.waveform,
      waveformReal: Boolean(cachedWaveform),
    };
  }),
});

export const saveSoundMetadata = (
  sound: SoundFile,
  patch: { labelColor?: LabelColor; favorite?: boolean; waveform?: Float32Array; clearLabel?: boolean },
) => {
  const cache = loadDocument();
  const key = soundKey(sound);
  const current = cache.sounds[key] || {};
  if (patch.clearLabel) delete current.labelColor;
  else if (patch.labelColor) current.labelColor = patch.labelColor;
  if (typeof patch.favorite === "boolean") current.favorite = patch.favorite;
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
