import { contextBridge, ipcRenderer } from "electron/renderer";
import { PLUGIN_VERSION, type BridgeError, type CloudSfxMediaRequest, type CloudSfxSearchRequest, type FreesoundDownloadRequest, type FreesoundPreviewRequest, type FreesoundSearchRequest, type ImportAudioRequest, type InsertAudioRequest, type LibraryScanProgress, type PortableLibraryMetadata, type PortablePreferences, type PreparedAudioWriteRequest, type RemoteAudioProgress, type ResolveSfxDensity, type ResolveSfxPlacementRequest, type ResolveSfxScope, type SoundDesignerBridge } from "../shared/types";

const bridge: SoundDesignerBridge = {
  runtime: {
    mode: "resolve",
    version: PLUGIN_VERSION,
    openExternal: (url: string) => ipcRenderer.invoke("runtime:open-external", url),
    getLatestRelease: (etag?: string) => ipcRenderer.invoke("runtime:get-latest-release", etag),
    setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke("runtime:set-always-on-top", value),
  },
  storage: {
    getFreesoundApiKey: (legacyKey?: string) => ipcRenderer.invoke("storage:get-freesound-api-key", legacyKey),
    saveFreesoundApiKey: (value: string) => ipcRenderer.invoke("storage:save-freesound-api-key", value),
    getInfo: () => ipcRenderer.invoke("storage:get-info"),
    getPreferences: () => ipcRenderer.invoke("storage:get-preferences"),
    savePreferences: (value: PortablePreferences) => ipcRenderer.invoke("storage:save-preferences", value),
    getLibraryMetadata: () => ipcRenderer.invoke("storage:get-library-metadata"),
    saveLibraryMetadata: (value: PortableLibraryMetadata) => ipcRenderer.invoke("storage:save-library-metadata", value),
    changeLocation: () => ipcRenderer.invoke("storage:change-location"),
  },
  resolve: {
    getContext: () => ipcRenderer.invoke("resolve:get-context"),
    ensureBin: () => ipcRenderer.invoke("resolve:ensure-bin"),
    importAudio: (request: ImportAudioRequest) => ipcRenderer.invoke("resolve:import-audio", request),
    insertAudio: (request: InsertAudioRequest) => ipcRenderer.invoke("resolve:insert-audio", request),
    analyzeSfx: (scope: ResolveSfxScope, density: ResolveSfxDensity) => ipcRenderer.invoke("resolve:analyze-sfx", { scope, density }),
    placeSfx: (request: ResolveSfxPlacementRequest) => ipcRenderer.invoke("resolve:place-sfx", request),
  },
  audio: {
    chooseWav: () => ipcRenderer.invoke("audio:choose-wav"),
    startDrag: async (request: ImportAudioRequest) => {
      ipcRenderer.send("audio:start-drag", request);
      return { ok: true, data: { started: true } };
    },
    onDragError: (listener: (error: BridgeError) => void) => {
      const handler = (_event: unknown, error: BridgeError) => listener(error);
      ipcRenderer.on("audio:drag-error", handler);
      return () => ipcRenderer.removeListener("audio:drag-error", handler);
    },
    readFile: (path: string) => ipcRenderer.invoke("audio:read-file", path),
    writePrepared: (request: PreparedAudioWriteRequest) => ipcRenderer.invoke("audio:write-prepared", request),
  },
  cloud: {
    searchCloudSfx: (request: CloudSfxSearchRequest) => ipcRenderer.invoke("cloud:sfx-search", request),
    readCloudSfxPreview: (request: CloudSfxMediaRequest) => ipcRenderer.invoke("cloud:sfx-preview", request),
    downloadCloudSfx: (request: CloudSfxMediaRequest) => ipcRenderer.invoke("cloud:sfx-download", request),
    searchFreesound: (request: FreesoundSearchRequest) => ipcRenderer.invoke("cloud:freesound-search", request),
    downloadFreesound: (request: FreesoundDownloadRequest) => ipcRenderer.invoke("cloud:freesound-download", request),
    readFreesoundPreview: (request: FreesoundPreviewRequest) => ipcRenderer.invoke("cloud:freesound-preview", request),
    cancel: (operationId: string) => ipcRenderer.invoke("cloud:cancel", operationId),
    onDownloadProgress: (listener: (progress: RemoteAudioProgress) => void) => {
      const handler = (_event: unknown, progress: RemoteAudioProgress) => listener(progress);
      ipcRenderer.on("cloud:download-progress", handler);
      return () => ipcRenderer.removeListener("cloud:download-progress", handler);
    },
  },
  library: {
    getSnapshot: () => ipcRenderer.invoke("library:get-snapshot"),
    addFolder: () => ipcRenderer.invoke("library:add-folder"),
    chooseFolder: () => ipcRenderer.invoke("library:choose-folder"),
    scanFolder: (path: string) => ipcRenderer.invoke("library:scan-folder", path),
    rescan: (folderId?: string) => ipcRenderer.invoke("library:rescan", folderId),
    removeFolder: (folderId: string) => ipcRenderer.invoke("library:remove-folder", folderId),
    cancelScan: () => ipcRenderer.invoke("library:cancel-scan"),
    setSoundFavorite: (soundId: string, favorite: boolean) => ipcRenderer.invoke("library:set-sound-favorite", { soundId, favorite }),
    setFolderPinned: (nodeId: string, pinned: boolean) => ipcRenderer.invoke("library:set-folder-pinned", { nodeId, pinned }),
    setSoundLabel: (soundId: string, labelColor?: string) => ipcRenderer.invoke("library:set-sound-label", { soundId, labelColor }),
    setFolderLabel: (nodeId: string, labelColor?: string) => ipcRenderer.invoke("library:set-folder-label", { nodeId, labelColor }),
    onScanProgress: (listener: (progress: LibraryScanProgress) => void) => {
      const handler = (_event: unknown, progress: LibraryScanProgress) => listener(progress);
      ipcRenderer.on("library:scan-progress", handler);
      return () => ipcRenderer.removeListener("library:scan-progress", handler);
    },
  },
};

contextBridge.exposeInMainWorld("soundDesigner", bridge);
