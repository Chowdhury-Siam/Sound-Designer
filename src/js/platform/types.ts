import type { HostApp, HostProjectContext, HostResult, InsertAudioRequest, LabelColor, LibraryFolder, SoundFile } from "../main/types";
import type { SfxAnalysis, SfxDensity, SfxPlacement, SfxPlacementResult, SfxScope } from "../main/sfxAssistant";

export type PlatformMode = "adobe" | "resolve" | "browser";

export type PlatformCapabilities = {
  nativeStorage: boolean;
  nativeLibrary: boolean;
  nativeAudioPreparation: boolean;
  nativeProjectHandoff: boolean;
  nativeDrag: boolean;
  nativeCloud: boolean;
  nativeUpdates: boolean;
  nativeSfxAssistant: boolean;
};

export type PlatformError = { code: string; message: string };
export type PlatformResult<T> = { ok: true; data: T } | { ok: false; error: PlatformError };
export type PlatformLibrarySnapshot = { folders: LibraryFolder[]; sounds: SoundFile[]; updatedAt: number };
export type PlatformPreparedAudioFile = { path: string; projectRoot: string; size: number; modifiedAt: number };
export type PlatformPreparedAudioWrite = {
  sourceId: string;
  displayName: string;
  kind: "downloads" | "converted" | "processed" | "segments";
  bytes: Uint8Array;
  projectPath: string;
  metadata?: Record<string, unknown>;
};

export type PlatformDragAudio = { path: string; sourceId: string; displayName: string; projectPath?: string };

export type PlatformStorageInfo = { root: string; manifestPath: string };
export type PlatformPortablePreferences = {
  autoPreview: boolean;
  loop: boolean;
  localSourceEnabled: boolean;
  cloudLibraryEnabled: boolean;
  freesoundLibraryEnabled: boolean;
  freesoundSourceEnabled: boolean;
  insertionTarget: "playhead" | "selected-clip";
  conversionPolicy: "unsupported" | "always" | "never";
  normalization: "preserve" | "peak-minus-one" | "manual";
  normalizationTargetDb: number;
  freesoundLicenseFilter: "commercial" | "cc0" | "all";
};

export type AfterEffectsAudioDragState = {
  ok: boolean;
  host: string;
  compositionId?: number;
  layerCount: number;
  message: string;
};

// Opaque payloads cross this boundary only after the native adapter validates them.
// Shared feature modules own their product-level shapes and parsing.
export interface SoundDesignerPlatform {
  mode: PlatformMode;
  host: HostApp;
  capabilities: PlatformCapabilities;
  initialize(): void;
  runtime: {
    setAlwaysOnTop?(value: boolean): Promise<PlatformResult<{ alwaysOnTop: boolean }>>;
    openExternal(url: string): Promise<PlatformResult<{ opened: true }>>;
    registerKeyEventsInterest(events: { keyCode: number; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }[]): void;
  };
  storage: {
    getFreesoundApiKey(legacyKey?: string): Promise<PlatformResult<string>>;
    saveFreesoundApiKey(value: string): Promise<PlatformResult<{ saved: true }>>;
    getInfo(): Promise<PlatformResult<PlatformStorageInfo>>;
    getPreferences(): Promise<PlatformResult<PlatformPortablePreferences | null>>;
    savePreferences(value: PlatformPortablePreferences): Promise<PlatformResult<{ saved: true }>>;
    getLibraryMetadata(): Promise<PlatformResult<unknown | null>>;
    saveLibraryMetadata(value: unknown): Promise<PlatformResult<{ saved: true }>>;
    changeLocation(): Promise<PlatformResult<PlatformStorageInfo | null>>;
    getProjectRoot(project: HostProjectContext): Promise<PlatformResult<string>>;
  };
  library: {
    onScanProgress?(listener: (progress: { files: number; folders: number; currentPath: string }) => void): () => void;
    getSnapshot(): Promise<PlatformResult<PlatformLibrarySnapshot>>;
    addFolder(): Promise<PlatformResult<PlatformLibrarySnapshot | null>>;
    chooseFolder(): Promise<PlatformResult<string | null>>;
    rescan(folderId?: string): Promise<PlatformResult<PlatformLibrarySnapshot>>;
    removeFolder(folderId: string): Promise<PlatformResult<PlatformLibrarySnapshot>>;
    setSoundFavorite(soundId: string, favorite: boolean): Promise<PlatformResult<PlatformLibrarySnapshot>>;
    setFolderPinned(nodeId: string, pinned: boolean): Promise<PlatformResult<PlatformLibrarySnapshot>>;
    setSoundLabel(soundId: string, labelColor?: LabelColor): Promise<PlatformResult<PlatformLibrarySnapshot>>;
    setFolderLabel(nodeId: string, labelColor?: LabelColor): Promise<PlatformResult<PlatformLibrarySnapshot>>;
  };
  audio: {
    readFile(path: string): Promise<PlatformResult<Uint8Array>>;
    writePrepared(value: PlatformPreparedAudioWrite): Promise<PlatformResult<PlatformPreparedAudioFile>>;
    startDrag(value: PlatformDragAudio): Promise<PlatformResult<unknown>>;
    onDragError(listener: (error: PlatformError) => void): () => void;
  };
  project: {
    getContext(): Promise<HostProjectContext>;
  };
  handoff: {
    insertAudio(request: InsertAudioRequest): Promise<HostResult>;
    organizeAudio(request: InsertAudioRequest): Promise<HostResult>;
    getAfterEffectsDragState(request: InsertAudioRequest): Promise<AfterEffectsAudioDragState>;
  };
  cloud: {
    onDownloadProgress?(listener: (progress: { operationId: string; receivedBytes: number; totalBytes?: number; progress?: number }) => void): () => void;
    searchFreesound(value: unknown): Promise<PlatformResult<unknown>>;
    readFreesoundPreview(value: unknown): Promise<PlatformResult<Uint8Array>>;
    downloadFreesound(value: unknown): Promise<PlatformResult<PlatformPreparedAudioFile>>;
    cancel(operationId: string): Promise<PlatformResult<unknown>>;
    search(value: unknown): Promise<PlatformResult<unknown>>;
    readPreview(value: unknown): Promise<PlatformResult<Uint8Array>>;
    download(value: unknown): Promise<PlatformResult<PlatformPreparedAudioFile>>;
  };
  updates: {
    getLatestRelease(etag?: string): Promise<PlatformResult<unknown>>;
  };
  sfx: {
    analyze(scope: SfxScope, density: SfxDensity): Promise<SfxAnalysis>;
    place(compositionId: number, placements: SfxPlacement[]): Promise<SfxPlacementResult>;
  };
}
