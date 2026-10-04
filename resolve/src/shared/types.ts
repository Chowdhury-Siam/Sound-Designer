import { version } from "../../../package.json";

export const PLUGIN_ID = "com.sound.designer.resolve";
export const PLUGIN_VERSION = version;
export const SOUND_DESIGNER_BIN = "SoundDesigner";

export type ChannelMode = "mono" | "stereo";

export type ResolveContext = {
  projectId: string;
  projectName: string;
  timelineId?: string;
  timelineName?: string;
  currentPage?: string;
  playheadTimecode?: string;
};

export type ResolveBin = {
  id: string;
  name: typeof SOUND_DESIGNER_BIN;
};

export type SelectedAudioFile = {
  path: string;
  name: string;
};

export type ImportAudioRequest = {
  path: string;
  sourceId: string;
  displayName: string;
  projectId?: string;
};

export type ImportedAudio = {
  mediaPoolItemId: string;
  existing: boolean;
};

export type InsertAudioRequest = {
  preparedPath: string;
  displayName: string;
  mediaPoolItemId?: string;
  trackIndex?: number;
  channelMode: ChannelMode;
  target?: "playhead" | "fairlight-selected-track";
  projectId?: string;
};

export type InsertedAudio = {
  trackIndex?: number;
  recordFrame: number;
  timelineItemCount: number;
  target: "timeline-track" | "fairlight-selected-track";
};

export type ResolveSfxKind = "click" | "slide" | "whoosh";
export type ResolveSfxScope = "playhead" | "timeline" | "markers";
export type ResolveSfxDensity = "sparse" | "balanced" | "detailed";

export type ResolveSfxMoment = {
  frame: number;
  time: number;
  duration: number;
  intensity: number;
  type: ResolveSfxKind;
  source: string;
  reason: string;
};

export type ResolveSfxAnalysis = {
  timelineId: string;
  timelineName: string;
  frameRate: number;
  analyzedItems: number;
  moments: ResolveSfxMoment[];
};

export type ResolveSfxPlacement = {
  recordFrame: number;
  preparedPath: string;
  displayName: string;
  sourceId: string;
  channelMode: ChannelMode;
};

export type ResolveSfxPlacementRequest = {
  timelineId: string;
  placements: ResolveSfxPlacement[];
};

export type ResolveSfxPlacementResult = { placed: number };

export type NativeDragResult = {
  started: true;
};

export type PreparedAudioKind = "downloads" | "converted" | "processed" | "segments";

export type PreparedAudioWriteRequest = {
  sourceId: string;
  displayName: string;
  kind: PreparedAudioKind;
  bytes: Uint8Array;
  projectId: string;
  metadata?: Record<string, unknown>;
};

export type PreparedAudioFile = {
  path: string;
  projectRoot: string;
  size: number;
  modifiedAt: number;
};

export type FreesoundSearchRequest = {
  operationId: string;
  url: string;
  apiKey: string;
};

export type FreesoundDownloadRequest = {
  operationId: string;
  url: string;
  sourceId: string;
  displayName: string;
  creator?: string;
  license?: string;
  sourceUrl?: string;
};

export type FreesoundPreviewRequest = {
  operationId: string;
  url: string;
};

export type CloudSfxSearchItem = { id: string; name: string };

export type CloudSfxSearchRequest = { operationId: string; query: string };

export type CloudSfxMediaRequest = {
  operationId: string;
  sourceId: string;
  displayName?: string;
};

export type GithubReleaseResponse = {
  notModified: boolean;
  etag?: string;
  release?: unknown;
};

export type RemoteAudioProgress = {
  operationId: string;
  receivedBytes: number;
  totalBytes?: number;
  progress?: number;
};

export type LibraryLabelColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

export type LibraryTreeNode = {
  id: string;
  rootId: string;
  name: string;
  path: string;
  directFileCount: number;
  totalFileCount: number;
  labelColor?: LibraryLabelColor;
  pinned?: boolean;
  children: LibraryTreeNode[];
};

export type LibraryFolder = {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  indexedAt: number;
  tree: LibraryTreeNode;
};

export type LibrarySound = {
  id: string;
  folderId: string;
  directoryId: string;
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: number;
  duration: number;
  tags: string[];
  waveform: number[];
  labelColor?: LibraryLabelColor;
  favorite?: boolean;
};

export type LibrarySnapshot = {
  folders: LibraryFolder[];
  sounds: LibrarySound[];
  updatedAt: number;
};

export type LibraryScanProgress = {
  operationId: string;
  files: number;
  folders: number;
  currentPath: string;
};

export type PortablePreferences = {
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

export type PortableLibraryMetadata = {
  version: 1;
  sounds: Record<string, {
    labelColor?: LibraryLabelColor;
    favorite?: boolean;
    favoriteCollection?: string;
    cloudSound?: Omit<LibrarySound, "waveform"> & {
      accent: "graphite";
      source?: "local" | "freesound" | "scorpion";
      sourceId?: string;
      sourceUrl?: string;
      previewUrl?: string;
      creator?: string;
      license?: string;
      provider?: string;
      channels?: number;
      sampleRate?: number;
    };
  }>;
  folders: Record<string, { labelColor?: LibraryLabelColor; pinned?: boolean }>;
  collections?: { id: string; name: string; parentId: string }[];
};

export type StorageInfo = {
  root: string;
  manifestPath: string;
};

export type BridgeError = {
  code: string;
  message: string;
};

export type BridgeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: BridgeError };

export interface SoundDesignerBridge {
  runtime: {
    mode: "resolve" | "browser-demo";
    version: string;
    openExternal(url: string): Promise<BridgeResult<{ opened: true }>>;
    getLatestRelease(etag?: string): Promise<BridgeResult<GithubReleaseResponse>>;
    setAlwaysOnTop(value: boolean): Promise<BridgeResult<{ alwaysOnTop: boolean }>>;
  };
  storage: {
    getFreesoundApiKey(legacyKey?: string): Promise<BridgeResult<string>>;
    saveFreesoundApiKey(value: string): Promise<BridgeResult<{ saved: true }>>;
    getInfo(): Promise<BridgeResult<StorageInfo>>;
    getPreferences(): Promise<BridgeResult<PortablePreferences | null>>;
    savePreferences(value: PortablePreferences): Promise<BridgeResult<{ saved: true }>>;
    getLibraryMetadata(): Promise<BridgeResult<PortableLibraryMetadata | null>>;
    saveLibraryMetadata(value: PortableLibraryMetadata): Promise<BridgeResult<{ saved: true }>>;
    changeLocation(): Promise<BridgeResult<StorageInfo | null>>;
  };
  resolve: {
    getContext(): Promise<BridgeResult<ResolveContext>>;
    ensureBin(): Promise<BridgeResult<ResolveBin>>;
    importAudio(request: ImportAudioRequest): Promise<BridgeResult<ImportedAudio>>;
    insertAudio(request: InsertAudioRequest): Promise<BridgeResult<InsertedAudio>>;
    analyzeSfx(scope: ResolveSfxScope, density: ResolveSfxDensity): Promise<BridgeResult<ResolveSfxAnalysis>>;
    placeSfx(request: ResolveSfxPlacementRequest): Promise<BridgeResult<ResolveSfxPlacementResult>>;
  };
  audio: {
    chooseWav(): Promise<BridgeResult<SelectedAudioFile | null>>;
    startDrag(request: ImportAudioRequest): Promise<BridgeResult<NativeDragResult>>;
    onDragError(listener: (error: BridgeError) => void): () => void;
    readFile(path: string): Promise<BridgeResult<Uint8Array>>;
    writePrepared(request: PreparedAudioWriteRequest): Promise<BridgeResult<PreparedAudioFile>>;
  };
  cloud: {
    searchCloudSfx(request: CloudSfxSearchRequest): Promise<BridgeResult<CloudSfxSearchItem[]>>;
    readCloudSfxPreview(request: CloudSfxMediaRequest): Promise<BridgeResult<Uint8Array>>;
    downloadCloudSfx(request: CloudSfxMediaRequest): Promise<BridgeResult<PreparedAudioFile>>;
    searchFreesound(request: FreesoundSearchRequest): Promise<BridgeResult<unknown>>;
    downloadFreesound(request: FreesoundDownloadRequest): Promise<BridgeResult<PreparedAudioFile>>;
    readFreesoundPreview(request: FreesoundPreviewRequest): Promise<BridgeResult<Uint8Array>>;
    cancel(operationId: string): Promise<BridgeResult<{ cancelled: boolean }>>;
    onDownloadProgress(listener: (progress: RemoteAudioProgress) => void): () => void;
  };
  library: {
    getSnapshot(): Promise<BridgeResult<LibrarySnapshot>>;
    addFolder(): Promise<BridgeResult<LibrarySnapshot | null>>;
    chooseFolder(): Promise<BridgeResult<string | null>>;
    scanFolder(path: string): Promise<BridgeResult<LibrarySnapshot>>;
    rescan(folderId?: string): Promise<BridgeResult<LibrarySnapshot>>;
    removeFolder(folderId: string): Promise<BridgeResult<LibrarySnapshot>>;
    cancelScan(): Promise<BridgeResult<{ cancelled: boolean }>>;
    setSoundFavorite(soundId: string, favorite: boolean): Promise<BridgeResult<LibrarySnapshot>>;
    setFolderPinned(nodeId: string, pinned: boolean): Promise<BridgeResult<LibrarySnapshot>>;
    setSoundLabel(soundId: string, labelColor?: LibraryLabelColor): Promise<BridgeResult<LibrarySnapshot>>;
    setFolderLabel(nodeId: string, labelColor?: LibraryLabelColor): Promise<BridgeResult<LibrarySnapshot>>;
    onScanProgress(listener: (progress: LibraryScanProgress) => void): () => void;
  };
}
