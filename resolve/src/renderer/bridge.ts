import type { HostProjectContext, HostResult, InsertAudioRequest, LibraryFolder, SoundFile } from "../../../src/js/main/types";
import type { SfxAnalysis, SfxDensity, SfxPlacement, SfxPlacementResult, SfxScope } from "../../../src/js/main/sfxAssistant";
import type { AfterEffectsAudioDragState, PlatformResult, SoundDesignerPlatform } from "../../../src/js/platform/types";
import type { BridgeResult, ResolveSfxScope, SoundDesignerBridge } from "../shared/types";

declare global {
  interface Window { soundDesigner?: SoundDesignerBridge }
}

const bridge = (): SoundDesignerBridge => {
  if (!window.soundDesigner) throw new Error("The Resolve preload bridge is unavailable.");
  return window.soundDesigner;
};

const asPlatformResult = <T>(result: BridgeResult<T>): PlatformResult<T> =>
  result.ok ? result : { ok: false, error: result.error };

const librarySnapshot = (snapshot: Awaited<ReturnType<SoundDesignerBridge["library"]["getSnapshot"]>>): PlatformResult<{ folders: LibraryFolder[]; sounds: SoundFile[]; updatedAt: number }> => {
  if (!snapshot.ok) return { ok: false, error: snapshot.error };
  return {
    ok: true,
    data: {
      updatedAt: snapshot.data.updatedAt,
      folders: snapshot.data.folders.map((folder) => ({ ...folder, accent: "graphite" })),
      sounds: snapshot.data.sounds.map((sound) => ({ ...sound, waveform: new Float32Array(sound.waveform), accent: "graphite", source: "local" })),
    },
  };
};

const failure = (message: string): HostResult => ({ ok: false, host: "resolve", message });
const resolveScope = (scope: SfxScope): ResolveSfxScope => scope === "selected" ? "markers" : "timeline";
const resolveProjectId = (projectPath?: string): string | undefined => projectPath?.startsWith("resolve:") ? projectPath.slice(8) || undefined : undefined;

let analyzedTimelineId = "";
let analyzedFrameRate = 0;

const getContext = async (): Promise<HostProjectContext> => {
  const result = await bridge().resolve.getContext();
  if (!result.ok) return { ok: false, host: "resolve", message: result.error.message };
  return {
    ok: true,
    host: "resolve",
    projectPath: `resolve:${result.data.projectId}`,
    projectName: result.data.projectName,
    message: result.data.timelineName
      ? `Resolve project ${result.data.projectName}; timeline ${result.data.timelineName}.`
      : `Resolve project ${result.data.projectName}.`,
  };
};

const importAudio = async (request: InsertAudioRequest) => {
  const bin = await bridge().resolve.ensureBin();
  if (!bin.ok) return bin;
  return bridge().resolve.importAudio({ path: request.path, sourceId: request.path, displayName: request.name, projectId: resolveProjectId(request.projectPath) });
};

const insertAudio = async (request: InsertAudioRequest): Promise<HostResult> => {
  if (!request.path) return failure("This sound has no prepared local source file.");
  const inserted = await bridge().resolve.insertAudio({
    preparedPath: request.path,
    displayName: request.name,
    trackIndex: request.targetAudioTrack > 0 ? request.targetAudioTrack : undefined,
    channelMode: request.channelMode || "stereo",
    target: request.insertionTarget === "selected-clip" ? "fairlight-selected-track" : "playhead",
    projectId: resolveProjectId(request.projectPath),
  });
  if (!inserted.ok) return failure(inserted.error.message);
  return { ok: true, host: "resolve", imported: true, trackIndex: inserted.data.trackIndex, message: "Audio inserted in DaVinci Resolve." };
};

const organizeAudio = async (request: InsertAudioRequest): Promise<HostResult> => {
  if (!request.path) return failure("This sound has no prepared local source file.");
  const imported = await importAudio(request);
  if (!imported.ok) return failure(imported.error.message);
  return { ok: true, host: "resolve", imported: true, message: "Audio is available in the SoundDesigner Media Pool bin." };
};

const analyzeSfx = async (scope: SfxScope, density: SfxDensity): Promise<SfxAnalysis> => {
  analyzedTimelineId = "";
  const result = await bridge().resolve.analyzeSfx(resolveScope(scope), density);
  if (!result.ok) return { ok: false, message: result.error.message, compositionId: 0, compositionName: "", frameDuration: 0, analyzedLayers: 0, moments: [] };
  analyzedTimelineId = result.data.timelineId;
  analyzedFrameRate = result.data.frameRate;
  return {
    ok: true,
    message: `Analyzed ${result.data.analyzedItems} Resolve timeline items.`,
    compositionId: 1,
    compositionName: result.data.timelineName,
    frameDuration: result.data.frameRate > 0 ? 1 / result.data.frameRate : 0,
    analyzedLayers: result.data.analyzedItems,
    moments: result.data.moments.map((moment) => ({
      frame: moment.frame,
      time: moment.time,
      duration: moment.duration,
      intensity: moment.intensity,
      type: moment.type,
      layer: moment.source,
      reason: moment.reason,
    })),
  };
};

const placeSfx = async (_compositionId: number, placements: SfxPlacement[]): Promise<SfxPlacementResult> => {
  if (!analyzedTimelineId || analyzedFrameRate <= 0) return { ok: false, message: "Analyze the active Resolve timeline before placing SFX.", placed: 0 };
  if (placements.some(placement => !Number.isFinite(placement.frame))) return { ok: false, message: "Resolve placement frames are unavailable. Analyze the timeline again.", placed: 0 };
  const result = await bridge().resolve.placeSfx({
    timelineId: analyzedTimelineId,
    placements: placements.map((placement) => ({
      recordFrame: Math.max(0, Math.round(placement.frame! - placement.peakOffset * analyzedFrameRate)),
      preparedPath: placement.path,
      displayName: placement.name,
      sourceId: placement.sourceId || placement.path,
      channelMode: placement.channels === 1 ? "mono" : "stereo",
    })),
  });
  return result.ok
    ? { ok: true, message: `Placed ${result.data.placed} SFX in DaVinci Resolve.`, placed: result.data.placed }
    : { ok: false, message: result.error.message, placed: 0 };
};

export const createResolvePlatform = (): SoundDesignerPlatform => ({
  mode: "resolve",
  host: "resolve",
  capabilities: {
    nativeStorage: true,
    nativeLibrary: true,
    nativeAudioPreparation: true,
    nativeProjectHandoff: true,
    nativeDrag: true,
    nativeCloud: true,
    nativeUpdates: true,
    nativeSfxAssistant: true,
  },
  initialize: () => undefined,
  runtime: {
    setAlwaysOnTop: async (value) => asPlatformResult(await bridge().runtime.setAlwaysOnTop(value)),
    openExternal: async (url) => asPlatformResult(await bridge().runtime.openExternal(url)),
    registerKeyEventsInterest: () => undefined,
  },
  storage: {
    getFreesoundApiKey: async (legacyKey) => asPlatformResult(await bridge().storage.getFreesoundApiKey(legacyKey)),
    saveFreesoundApiKey: async (value) => asPlatformResult(await bridge().storage.saveFreesoundApiKey(value)),
    getInfo: async () => asPlatformResult(await bridge().storage.getInfo()),
    getPreferences: async () => asPlatformResult(await bridge().storage.getPreferences()),
    savePreferences: async (value) => asPlatformResult(await bridge().storage.savePreferences(value as Parameters<SoundDesignerBridge["storage"]["savePreferences"]>[0])),
    getLibraryMetadata: async () => asPlatformResult(await bridge().storage.getLibraryMetadata()),
    saveLibraryMetadata: async (value) => asPlatformResult(await bridge().storage.saveLibraryMetadata(JSON.parse(JSON.stringify(value)))),
    changeLocation: async () => asPlatformResult(await bridge().storage.changeLocation()),
    getProjectRoot: async () => ({ ok: false, error: { code: "UNSUPPORTED", message: "Resolve project storage is managed by the native audio service." } }),
  },
  library: {
    onScanProgress: (listener) => bridge().library.onScanProgress(listener),
    getSnapshot: async () => librarySnapshot(await bridge().library.getSnapshot()),
    addFolder: async () => {
      const result = await bridge().library.addFolder();
      if (!result.ok) return { ok: false, error: result.error };
      return result.data === null ? { ok: true, data: null } : librarySnapshot({ ok: true, data: result.data });
    },
    chooseFolder: async () => asPlatformResult(await bridge().library.chooseFolder()),
    rescan: async (folderId) => librarySnapshot(await bridge().library.rescan(folderId)),
    removeFolder: async (folderId) => librarySnapshot(await bridge().library.removeFolder(folderId)),
    setSoundFavorite: async (soundId, favorite) => librarySnapshot(await bridge().library.setSoundFavorite(soundId, favorite)),
    setFolderPinned: async (nodeId, pinned) => librarySnapshot(await bridge().library.setFolderPinned(nodeId, pinned)),
    setSoundLabel: async (soundId, labelColor) => librarySnapshot(await bridge().library.setSoundLabel(soundId, labelColor)),
    setFolderLabel: async (nodeId, labelColor) => librarySnapshot(await bridge().library.setFolderLabel(nodeId, labelColor)),
  },
  audio: {
    readFile: async (path) => asPlatformResult(await bridge().audio.readFile(path)),
    writePrepared: async (value) => asPlatformResult(await bridge().audio.writePrepared({ ...value, projectId: resolveProjectId(value.projectPath) || "" })),
    startDrag: async (value) => asPlatformResult(await bridge().audio.startDrag({ path: value.path, sourceId: value.sourceId, displayName: value.displayName, projectId: resolveProjectId(value.projectPath) })),
    onDragError: (listener) => bridge().audio.onDragError(listener),
  },
  project: { getContext },
  handoff: {
    insertAudio,
    organizeAudio,
    getAfterEffectsDragState: async (): Promise<AfterEffectsAudioDragState> => ({ ok: false, host: "resolve", layerCount: 0, message: "After Effects drag state is not used by Resolve." }),
  },
  cloud: {
    onDownloadProgress: (listener) => bridge().cloud.onDownloadProgress(listener),
    searchFreesound: async (value) => asPlatformResult(await bridge().cloud.searchFreesound(value as Parameters<SoundDesignerBridge["cloud"]["searchFreesound"]>[0])),
    readFreesoundPreview: async (value) => asPlatformResult(await bridge().cloud.readFreesoundPreview(value as Parameters<SoundDesignerBridge["cloud"]["readFreesoundPreview"]>[0])),
    downloadFreesound: async (value) => asPlatformResult(await bridge().cloud.downloadFreesound(value as Parameters<SoundDesignerBridge["cloud"]["downloadFreesound"]>[0])),
    cancel: async (operationId) => asPlatformResult(await bridge().cloud.cancel(operationId)),
    search: async (value) => asPlatformResult(await bridge().cloud.searchCloudSfx(value as Parameters<SoundDesignerBridge["cloud"]["searchCloudSfx"]>[0])),
    readPreview: async (value) => asPlatformResult(await bridge().cloud.readCloudSfxPreview(value as Parameters<SoundDesignerBridge["cloud"]["readCloudSfxPreview"]>[0])),
    download: async (value) => asPlatformResult(await bridge().cloud.downloadCloudSfx(value as Parameters<SoundDesignerBridge["cloud"]["downloadCloudSfx"]>[0])),
  },
  updates: { getLatestRelease: async (etag) => asPlatformResult(await bridge().runtime.getLatestRelease(etag)) },
  sfx: { analyze: analyzeSfx, place: placeSfx },
});
