export type HostApp = "premiere" | "aftereffects" | "browser" | "unknown";

export type AccentName = "graphite";

export type LabelColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

export type SoundSource = "local" | "freesound" | "scorpion";

export type AudioConversionPolicy = "unsupported" | "always" | "never";

export type AudioNormalization = "preserve" | "peak-minus-one" | "manual";

export type AudioPreparationStage = "downloading" | "converting";

export type AudioPreparationStatus = {
  stage: AudioPreparationStage;
  message: string;
  progress?: number;
};

export type AudioSegmentSelection = {
  start: number;
  end: number;
};

export type AudioProcessingSettings = {
  bypass?: boolean;
  normalize?: boolean;
  echoMix?: number;
  reverbMix?: number;
  reverse: boolean;
  gainDb: number;
  pitchSemitones: number;
  speed: number;
  preservePitch: boolean;
};

export type InsertionTarget = "playhead" | "selected-clip";

export type FreesoundLicenseFilter = "commercial" | "cc0" | "all";

export type SoundDesignerPreferences = {
  autoPreview: boolean;
  loop: boolean;
  localSourceEnabled: boolean;
  freesoundLibraryEnabled: boolean;
  freesoundSourceEnabled: boolean;
  insertionTarget: InsertionTarget;
  conversionPolicy: AudioConversionPolicy;
  normalization: AudioNormalization;
  normalizationTargetDb: number;
  freesoundApiKey: string;
  freesoundLicenseFilter: FreesoundLicenseFilter;
};

export type LibraryTreeNode = {
  id: string;
  rootId: string;
  name: string;
  path: string;
  directFileCount: number;
  totalFileCount: number;
  labelColor?: LabelColor;
  pinned?: boolean;
  children: LibraryTreeNode[];
};

export type LibraryFolder = {
  id: string;
  name: string;
  path: string;
  fileCount: number;
  accent: AccentName;
  indexedAt: number;
  tree: LibraryTreeNode;
};

export type SoundFile = {
  favoriteCollection?: string;
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
  waveform: Float32Array;
  waveformReal?: boolean;
  accent: AccentName;
  labelColor?: LabelColor;
  favorite?: boolean;
  source?: SoundSource;
  sourceId?: string;
  sourceUrl?: string;
  previewUrl?: string;
  creator?: string;
  license?: string;
  channels?: number;
  sampleRate?: number;
  downloadState?: "remote" | "downloading" | "ready" | "error";
  preparedProjectPath?: string;
  preparedProfile?: string;
  originalPath?: string;
  originalExtension?: string;
};

export type ScanProgress = {
  files: number;
  folders: number;
  currentPath: string;
};

export type SearchTab = {
  id: string;
  label: string;
  query: string;
  folderId: string;
};

export type ToastMessage = {
  id: number;
  type: "success" | "warning" | "error" | "info";
  message: string;
};

export type InsertAudioRequest = {
  path: string;
  name: string;
  targetAudioTrack: number;
  insertionTarget?: InsertionTarget;
};

export type HostResult = {
  ok: boolean;
  message: string;
  host?: string;
  imported?: boolean;
  trackIndex?: number;
};

export type HostProjectContext = {
  ok: boolean;
  host: HostApp | string;
  projectPath?: string;
  projectDirectory?: string;
  projectName?: string;
  message: string;
};
