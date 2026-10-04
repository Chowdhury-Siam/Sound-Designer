import type { ImportAudioRequest, InsertAudioRequest, LibraryLabelColor, PortableLibraryMetadata, PortablePreferences, ResolveSfxDensity, ResolveSfxPlacementRequest, ResolveSfxScope } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, field: string, maxLength = 4096): string => {
  if (typeof value !== "string") throw new ContractError("INVALID_ARGUMENT", `${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new ContractError("INVALID_ARGUMENT", `${field} is required.`);
  if (normalized.length > maxLength) throw new ContractError("INVALID_ARGUMENT", `${field} is too long.`);
  return normalized;
};

export class ContractError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ContractError";
  }
}

export const parseImportAudioRequest = (value: unknown): ImportAudioRequest => {
  if (!isRecord(value)) throw new ContractError("INVALID_ARGUMENT", "Import request must be an object.");
  return {
    path: requiredString(value.path, "path"),
    sourceId: requiredString(value.sourceId, "sourceId", 256),
    displayName: requiredString(value.displayName, "displayName", 512),
    projectId: value.projectId === undefined ? undefined : requiredString(value.projectId, "projectId", 512),
  };
};

export const parseInsertAudioRequest = (value: unknown): InsertAudioRequest => {
  if (!isRecord(value)) throw new ContractError("INVALID_ARGUMENT", "Insert request must be an object.");
  const channelMode = value.channelMode;
  if (channelMode !== "mono" && channelMode !== "stereo") {
    throw new ContractError("INVALID_ARGUMENT", "channelMode must be mono or stereo.");
  }
  const trackIndex = value.trackIndex;
  if (trackIndex !== undefined && (!Number.isInteger(trackIndex) || Number(trackIndex) < 1 || Number(trackIndex) > 512)) {
    throw new ContractError("INVALID_ARGUMENT", "trackIndex must be a positive integer.");
  }
  const mediaPoolItemId = value.mediaPoolItemId === undefined
    ? undefined
    : requiredString(value.mediaPoolItemId, "mediaPoolItemId", 512);
  const target = value.target === undefined ? "playhead" : value.target;
  if (target !== "playhead" && target !== "fairlight-selected-track") {
    throw new ContractError("INVALID_ARGUMENT", "target must be playhead or fairlight-selected-track.");
  }
  return {
    preparedPath: requiredString(value.preparedPath, "preparedPath"),
    displayName: requiredString(value.displayName, "displayName", 512),
    mediaPoolItemId,
    trackIndex: trackIndex as number | undefined,
    channelMode,
    target,
    projectId: value.projectId === undefined ? undefined : requiredString(value.projectId, "projectId", 512),
  };
};

export const parseDragPath = (value: unknown): string => requiredString(value, "path");

export const parseResolveSfxAnalysisRequest = (value: unknown): { scope: ResolveSfxScope; density: ResolveSfxDensity } => {
  if (!isRecord(value)) throw new ContractError("INVALID_ARGUMENT", "SFX analysis request must be an object.");
  if (value.scope !== "playhead" && value.scope !== "timeline" && value.scope !== "markers") {
    throw new ContractError("INVALID_ARGUMENT", "SFX analysis scope is invalid.");
  }
  if (value.density !== "sparse" && value.density !== "balanced" && value.density !== "detailed") {
    throw new ContractError("INVALID_ARGUMENT", "SFX analysis density is invalid.");
  }
  return { scope: value.scope, density: value.density };
};

export const parseResolveSfxPlacementRequest = (value: unknown): ResolveSfxPlacementRequest => {
  if (!isRecord(value) || !Array.isArray(value.placements) || value.placements.length < 1 || value.placements.length > 60) {
    throw new ContractError("INVALID_ARGUMENT", "SFX placement requires 1 to 60 items.");
  }
  return {
    timelineId: requiredString(value.timelineId, "timelineId", 512),
    placements: value.placements.map((entry) => {
      if (!isRecord(entry) || !Number.isSafeInteger(entry.recordFrame) || Number(entry.recordFrame) < 0) {
        throw new ContractError("INVALID_ARGUMENT", "SFX placement frame is invalid.");
      }
      if (entry.channelMode !== "mono" && entry.channelMode !== "stereo") {
        throw new ContractError("INVALID_ARGUMENT", "SFX placement channel mode is invalid.");
      }
      return {
        recordFrame: Number(entry.recordFrame),
        preparedPath: requiredString(entry.preparedPath, "preparedPath"),
        displayName: requiredString(entry.displayName, "displayName", 512),
        sourceId: requiredString(entry.sourceId, "sourceId", 512),
        channelMode: entry.channelMode,
      };
    }),
  };
};

export const parseExternalUrl = (value: unknown): string => {
  let url: URL;
  try {
    url = new URL(requiredString(value, "url"));
  } catch {
    throw new ContractError("INVALID_URL", "The external URL is invalid.");
  }
  const host = url.hostname.toLocaleLowerCase("en-US");
  const path = url.pathname.toLocaleLowerCase("en-US");
  const trustedFreesound = host === "freesound.org" || host === "www.freesound.org";
  const trustedRelease = host === "github.com"
    && ["/iboyshanto/sounddesigner/releases", "/its-niloy/sounddesigner-resolve/releases"].some(base => path === base || path.startsWith(`${base}/`));
  if (url.protocol !== "https:" || url.username || url.password || !trustedFreesound && !trustedRelease) {
    throw new ContractError("INVALID_URL", "SoundDesigner cannot open an untrusted external URL.");
  }
  return url.toString();
};

const booleanField = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") throw new ContractError("INVALID_STORAGE_STATE", `${field} must be a boolean.`);
  return value;
};

export const parsePortablePreferences = (value: unknown): PortablePreferences => {
  if (!isRecord(value)) throw new ContractError("INVALID_STORAGE_STATE", "Portable preferences must be an object.");
  const insertionTarget = value.insertionTarget;
  const conversionPolicy = value.conversionPolicy;
  const normalization = value.normalization;
  const freesoundLicenseFilter = value.freesoundLicenseFilter;
  if (insertionTarget !== "playhead" && insertionTarget !== "selected-clip") throw new ContractError("INVALID_STORAGE_STATE", "The insertion target is invalid.");
  if (conversionPolicy !== "unsupported" && conversionPolicy !== "always" && conversionPolicy !== "never") throw new ContractError("INVALID_STORAGE_STATE", "The conversion policy is invalid.");
  if (normalization !== "preserve" && normalization !== "peak-minus-one" && normalization !== "manual") throw new ContractError("INVALID_STORAGE_STATE", "The normalization policy is invalid.");
  if (freesoundLicenseFilter !== "commercial" && freesoundLicenseFilter !== "cc0" && freesoundLicenseFilter !== "all") throw new ContractError("INVALID_STORAGE_STATE", "The Freesound license filter is invalid.");
  return {
    autoPreview: booleanField(value.autoPreview, "autoPreview"),
    loop: booleanField(value.loop, "loop"),
    localSourceEnabled: booleanField(value.localSourceEnabled, "localSourceEnabled"),
    cloudLibraryEnabled: booleanField(value.cloudLibraryEnabled, "cloudLibraryEnabled"),
    freesoundLibraryEnabled: booleanField(value.freesoundLibraryEnabled, "freesoundLibraryEnabled"),
    freesoundSourceEnabled: booleanField(value.freesoundSourceEnabled, "freesoundSourceEnabled"),
    insertionTarget,
    conversionPolicy,
    normalization,
    normalizationTargetDb: typeof value.normalizationTargetDb === "number" && Number.isFinite(value.normalizationTargetDb)
      ? Math.max(-24, Math.min(0, value.normalizationTargetDb)) : -3,
    freesoundLicenseFilter,
  };
};

export const parsePortableLibraryMetadata = (value: unknown): PortableLibraryMetadata => {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.sounds) || !isRecord(value.folders)) {
    throw new ContractError("INVALID_STORAGE_STATE", "Portable library metadata is invalid.");
  }
  const serialized = JSON.stringify(value);
  if (serialized.length > 16 * 1024 * 1024) throw new ContractError("INVALID_STORAGE_STATE", "Portable library metadata is too large.");
  const colors = new Set<LibraryLabelColor>(["red", "orange", "yellow", "green", "blue", "purple", "gray"]);
  const clean = <T extends "sounds" | "folders">(collection: Record<string, unknown>, kind: T) => {
    const result: Record<string, Record<string, unknown>> = {};
    for (const [key, entry] of Object.entries(collection)) {
      if (!key || key.length > 4096 || !isRecord(entry)) continue;
      const labelColor = colors.has(entry.labelColor as LibraryLabelColor) ? entry.labelColor as LibraryLabelColor : undefined;
      if (kind === "folders") {
        result[key] = { ...(labelColor ? { labelColor } : {}), ...(typeof entry.pinned === "boolean" ? { pinned: entry.pinned } : {}) };
        continue;
      }
      const favoriteCollection = typeof entry.favoriteCollection === "string" && entry.favoriteCollection.length <= 256 ? entry.favoriteCollection : undefined;
      let cloudSound: Record<string, unknown> | undefined;
      if (isRecord(entry.cloudSound) && (entry.cloudSound.source === "freesound" || entry.cloudSound.source === "scorpion")) {
        const sound = entry.cloudSound;
        const strings = ["id", "folderId", "directoryId", "name", "path", "extension", "sourceId"];
        if (strings.every((field) => typeof sound[field] === "string" && String(sound[field]).length <= 4096) && Array.isArray(sound.tags)) {
          cloudSound = {
            id: sound.id,
            folderId: sound.folderId,
            directoryId: sound.directoryId,
            name: sound.name,
            path: sound.path,
            extension: sound.extension,
            sourceId: sound.sourceId,
            source: sound.source,
            accent: "graphite",
            size: Number(sound.size) || 0,
            modifiedAt: Number(sound.modifiedAt) || 0,
            duration: Math.max(0, Number(sound.duration) || 0),
            tags: sound.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 100),
            ...(["sourceUrl", "previewUrl", "creator", "license", "provider", "downloadState", "preparedProjectPath", "preparedProfile", "originalPath", "originalExtension"]
              .reduce<Record<string, string>>((fields, field) => {
                if (typeof sound[field] === "string" && String(sound[field]).length <= 4096) fields[field] = String(sound[field]);
                return fields;
              }, {})),
            ...(Number.isFinite(Number(sound.channels)) ? { channels: Number(sound.channels) } : {}),
            ...(Number.isFinite(Number(sound.sampleRate)) ? { sampleRate: Number(sound.sampleRate) } : {}),
          };
        }
      }
      result[key] = {
        ...(labelColor ? { labelColor } : {}),
        ...(typeof entry.favorite === "boolean" ? { favorite: entry.favorite } : {}),
        ...(favoriteCollection !== undefined ? { favoriteCollection } : {}),
        ...(cloudSound ? { cloudSound } : {}),
      };
    }
    return result;
  };
  const collections = Array.isArray(value.collections) ? value.collections.slice(0, 1000).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.name !== "string" || typeof entry.parentId !== "string") return [];
    const id = entry.id.trim().slice(0, 256);
    const name = entry.name.trim().slice(0, 60);
    const parentId = entry.parentId.trim().slice(0, 256);
    return id && name && !/[\\/]/.test(name) && id !== parentId ? [{ id, name, parentId }] : [];
  }) : undefined;
  return {
    version: 1,
    sounds: clean(value.sounds, "sounds"),
    folders: clean(value.folders, "folders"),
    ...(collections ? { collections } : {}),
  } as PortableLibraryMetadata;
};
