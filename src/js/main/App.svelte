<script lang="ts">
import { isCloudSound } from "./cloudLibrary";

  import { onMount, tick, untrack } from "svelte";
  import {
    chooseLibraryFolder,
    fileUrl,
    folderNameFromPath,
    loadLibraryPaths,
    makeWaveform,
    nextAccent,
    saveLibraryPaths,
    sameNativePath,
    scanFolder,
    waitForPanelPaint,
  } from "./library";
  import {
    detectHost,
    getAfterEffectsAudioDragState,
    getHostProjectContext,
    insertAudioInHost,
    organizeAudioInHost,
    type AfterEffectsAudioDragState,
  } from "./hostBridge";
  import { platform } from "../platform/client";
  import type { PlatformLibrarySnapshot, PlatformPortablePreferences, PlatformStorageInfo } from "../platform/types";
  import { compactWaveformFromChannels, decodeAudioWaveformChannels, decodeRemoteAudioWaveformChannels, renderProcessedPreview } from "./audioWaveform";
  import { audioNormalizationKey, audioProcessingKey, DEFAULT_AUDIO_PROCESSING, hasAudioProcessing, normalizeAudioProcessing, normalizeTargetDb } from "./audioEffects";
  import { searchSoundSources, loadCloudEnabled, saveCloudEnabled, resolveCloudPreview } from "./cloudLibrary";
  import { prepareAudioForHost, prepareAudioSegmentForHost, requiresProjectAudioPreparation } from "./projectAudio";
  import { createLibraryTabs, createSearchTab, searchTabLabel, updateSearchTabFolder, updateSearchTabQuery } from "./searchTabs";
  import { checkForUpdates, dismissUpdate, INSTALLED_VERSION, isUpdateDismissed, type UpdateState } from "./updater";
  import { labelColorOrder } from "./labels";
  import { flushLibraryMetadata, hydrateLibraryMetadata, loadPortableLibraryMetadata, saveFolderMetadata, saveSoundMetadata, loadFavoriteCollections, saveFavoriteCollections, loadCloudFavorites, type FavoriteCollection } from "./libraryMetadata";
  import FavoriteSheet from "./components/FavoriteSheet.svelte";
  import type {
    AudioConversionPolicy,
    AudioNormalization,
    AudioProcessingSettings,
    AudioPreparationStatus,
    AudioSegmentSelection,
    FreesoundLicenseFilter,
    InsertionTarget,
    LabelColor,
    LibraryFolder,
    ScanProgress,
    SearchTab,
    SoundDesignerPreferences,
    SoundFile,
    ToastMessage,
  } from "./types";
  import { collectTreeIds, countTreeNodes, hostLabel } from "./ui-utils";
  import Icon from "./components/Icon.svelte";
  import IconButton from "./components/IconButton.svelte";
  import ToolbarPopover from "./components/ToolbarPopover.svelte";
  import EffectsRack from "./components/EffectsRack.svelte";
  import ColorLabelPicker from "./components/ColorLabelPicker.svelte";
  import LibrarySidebar from "./components/LibrarySidebar.svelte";
  import PreviewPane from "./components/PreviewPane.svelte";
  import SearchTabs from "./components/SearchTabs.svelte";
  import SettingsSheet from "./components/SettingsSheet.svelte";
  import SfxAssistantSheet from "./components/SfxAssistantSheet.svelte";
  import SoundRow from "./components/SoundRow.svelte";
  import Transport from "./components/Transport.svelte";
  import "./main.scss";

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "one-shot", label: "One shots" },
    { id: "ambience", label: "Ambience" },
    { id: "favorites", label: "Favorites" },
  ];
  const VIRTUALIZATION_THRESHOLD = 80;
  const VIRTUAL_OVERSCAN = 8;
  const PREFERENCES_STORAGE_KEY = "sounddesigner.preferences.v1";
  const LIBRARY_WIDTH_STORAGE_KEY = "sounddesigner.library-width.v1";
  const SIDEBAR_PIN_STORAGE_KEY = "sounddesigner.sidebar-pin.v1";
  const browsePreference = (key: string, fallback: string) => {
    try { return localStorage.getItem(`sounddesigner.browse.${key}`) || fallback; } catch (_) { return fallback; }
  };
  const readSidebarPin = () => {
    try { return localStorage.getItem(SIDEBAR_PIN_STORAGE_KEY) === "true"; } catch (_) { return false; }
  };
  const LIBRARY_MIN_WIDTH = 180;
  const LIBRARY_MAX_WIDTH = 560;
  const RESULTS_MIN_WIDTH = 320;
  const EMPTY_WAVEFORM_CHANNELS: Float32Array[] = [];
  const resultRowHeightForViewport = (compact = true) => {
    if (typeof window === "undefined") return 57;
    if (!compact) return 69;
    if (window.innerWidth <= 430) return 58;
    if (window.innerWidth >= 821 && window.innerHeight <= 600 && window.innerWidth / Math.max(1, window.innerHeight) >= 1.5) return 52;
    return 57;
  };
  type SortMode = "relevance" | "name" | "duration" | "label";

  const createBrowserDemoAudio = () => {
    const sampleRate = 8000;
    const duration = 8;
    const channelCount = 2;
    const frameCount = sampleRate * duration;
    const bytes = new Uint8Array(44 + frameCount * channelCount * 2);
    const view = new DataView(bytes.buffer);
    const ascii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    ascii(0, "RIFF");
    view.setUint32(4, bytes.length - 8, true);
    ascii(8, "WAVE");
    ascii(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channelCount * 2, true);
    view.setUint16(32, channelCount * 2, true);
    view.setUint16(34, 16, true);
    ascii(36, "data");
    view.setUint32(40, bytes.length - 44, true);
    let offset = 44;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const time = frame / sampleRate;
      const envelope = Math.exp(-((time % 2) * 7));
      const left = Math.sin(time * Math.PI * 2 * 220) * envelope * 0.42;
      const right = Math.sin(time * Math.PI * 2 * 330) * envelope * 0.42;
      view.setInt16(offset, Math.round(left * 32767), true);
      view.setInt16(offset + 2, Math.round(right * 32767), true);
      offset += 4;
    }
    let binary = "";
    for (let start = 0; start < bytes.length; start += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(start, Math.min(bytes.length, start + 0x8000)));
    }
    return { url: `data:audio/wav;base64,${btoa(binary)}`, size: bytes.length };
  };

  const loadLibraryWidth = () => {
    try {
      const raw = localStorage.getItem(LIBRARY_WIDTH_STORAGE_KEY);
      const stored = raw === null ? Number.NaN : Number(raw);
      if (Number.isFinite(stored)) return Math.max(120, Math.min(LIBRARY_MAX_WIDTH, stored));
    } catch (_error) {
      // Use the balanced default when host policy blocks local storage.
    }
    return 220;
  };

  const clampLibraryWidth = (value: number) => {
    const minimum = sidebarPinned ? 120 : LIBRARY_MIN_WIDTH;
    const available = Math.max(minimum, window.innerWidth - (sidebarPinned ? 160 : RESULTS_MIN_WIDTH));
    return Math.round(Math.max(minimum, Math.min(LIBRARY_MAX_WIDTH, available, value)));
  };

  const saveLibraryWidth = (value: number) => {
    try {
      localStorage.setItem(LIBRARY_WIDTH_STORAGE_KEY, String(Math.round(value)));
    } catch (_error) {
      // Resizing remains available for the current session.
    }
  };

  type AfterEffectsDragSession = {
    id: number;
    soundId: string;
    baseline: Promise<AfterEffectsAudioDragState>;
    leftPanel: boolean;
    cancelled: boolean;
  };

  type PreparationDragSession = {
    id: number;
    soundId: string;
    promise: Promise<SoundFile>;
    leftPanel: boolean;
    cancelled: boolean;
    announced: boolean;
  };

  const loadPreferences = (): SoundDesignerPreferences => {
    try {
      const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || "{}");
      return {
        autoPreview: typeof stored.autoPreview === "boolean" ? stored.autoPreview : true,
        loop: typeof stored.loop === "boolean" ? stored.loop : true,
        insertionTarget: stored.insertionTarget === "selected-clip" ? "selected-clip" : "playhead",
        localSourceEnabled: typeof stored.localSourceEnabled === "boolean" ? stored.localSourceEnabled : true,
        freesoundLibraryEnabled: typeof stored.freesoundLibraryEnabled === "boolean"
          ? stored.freesoundLibraryEnabled
          : Boolean(typeof stored.freesoundApiKey === "string" && stored.freesoundApiKey.trim()),
        freesoundSourceEnabled: typeof stored.freesoundSourceEnabled === "boolean" ? stored.freesoundSourceEnabled : true,
        conversionPolicy: stored.conversionPolicy === "always" || stored.conversionPolicy === "never" ? stored.conversionPolicy : "unsupported",
        normalization: stored.normalization === "peak-minus-one" || stored.normalization === "manual" ? stored.normalization : "preserve",
        normalizationTargetDb: normalizeTargetDb(typeof stored.normalizationTargetDb === "number" ? stored.normalizationTargetDb : -3),
        freesoundApiKey: typeof stored.freesoundApiKey === "string" ? stored.freesoundApiKey : "",
        freesoundLicenseFilter: stored.freesoundLicenseFilter === "cc0" || stored.freesoundLicenseFilter === "all" ? stored.freesoundLicenseFilter : "commercial",
      };
    } catch (_error) {
      return {
        autoPreview: true,
        loop: true,
        insertionTarget: "playhead" as InsertionTarget,
        localSourceEnabled: true,
        freesoundLibraryEnabled: false,
        freesoundSourceEnabled: true,
        conversionPolicy: "unsupported" as AudioConversionPolicy,
        normalization: "preserve" as AudioNormalization,
        normalizationTargetDb: -3,
        freesoundApiKey: "",
        freesoundLicenseFilter: "commercial" as FreesoundLicenseFilter,
      };
    }
  };

  const savePreferences = (
    nextAutoPreview: boolean,
    nextLoop: boolean,
    nextInsertionTarget: InsertionTarget,
    nextLocalSourceEnabled: boolean,
    nextFreesoundLibraryEnabled: boolean,
    nextFreesoundSourceEnabled: boolean,
    nextConversionPolicy: AudioConversionPolicy,
    nextNormalization: AudioNormalization,
    nextNormalizationTargetDb: number,
    nextFreesoundApiKey: string,
    nextFreesoundLicenseFilter: FreesoundLicenseFilter,
  ) => {
    try {
      localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify({
        autoPreview: nextAutoPreview,
        loop: nextLoop,
        insertionTarget: nextInsertionTarget,
        localSourceEnabled: nextLocalSourceEnabled,
        freesoundLibraryEnabled: nextFreesoundLibraryEnabled,
        freesoundSourceEnabled: nextFreesoundSourceEnabled,
        conversionPolicy: nextConversionPolicy,
        normalization: nextNormalization,
        normalizationTargetDb: normalizeTargetDb(nextNormalizationTargetDb),
        freesoundApiKey: credentialsReady && platform().capabilities.nativeStorage ? undefined : nextFreesoundApiKey,
        freesoundLicenseFilter: nextFreesoundLicenseFilter,
      }));
    } catch (_error) {
      // The panel remains usable if host policy blocks local storage.
    }
  };

  const preferences = loadPreferences();
  const host = detectHost();
  let alwaysOnTop = $state(false);
  onMount(() => {
    const runtime = platform().runtime;
    if (!runtime.setAlwaysOnTop) return;
    try { alwaysOnTop = localStorage.getItem("sounddesigner.always-on-top.v1") === "true"; } catch (_error) {}
    void runtime.setAlwaysOnTop(alwaysOnTop).then(result => { if (!result.ok) notify("warning", result.error.message); });
  });
  const toggleAlwaysOnTop = async () => {
    const result = await platform().runtime.setAlwaysOnTop?.(!alwaysOnTop);
    if (!result) return;
    if (!result.ok) { notify("error", result.error.message); return; }
    alwaysOnTop = result.data.alwaysOnTop;
    try { localStorage.setItem("sounddesigner.always-on-top.v1", String(alwaysOnTop)); } catch (_error) {}
  };
  onMount(() => platform().library.onScanProgress?.((progress) => { indexProgress = progress; }));
  const browserDemoRequested = import.meta.env.DEV && host === "browser" && new URLSearchParams(window.location.search).has("demo");
  const browserDemoAudio = browserDemoRequested ? createBrowserDemoAudio() : null;
  const browserDemoSound: SoundFile | null = browserDemoAudio ? {
    id: "browser-segment-demo",
    folderId: "browser-demo",
    directoryId: "browser-demo",
    name: "Segment Selection Demo",
    path: "",
    extension: "wav",
    size: browserDemoAudio.size,
    modifiedAt: 0,
    duration: 8,
    tags: ["demo", "impact", "stereo"],
    waveform: makeWaveform("browser-segment-demo", 160),
    accent: "graphite",
    source: "local",
    previewUrl: browserDemoAudio.url,
    channels: 2,
    sampleRate: 48000,
  } : null;
  let folders = $state<LibraryFolder[]>([]);
  let sounds = $state<SoundFile[]>(browserDemoSound ? [browserDemoSound] : []);
  let freesoundSounds = $state<SoundFile[]>([]);
  let localSourceEnabled = $state(preferences.localSourceEnabled);
  let cloudLibraryEnabled = $state(loadCloudEnabled());
  $effect(() => saveCloudEnabled(cloudLibraryEnabled));
  let freesoundLibraryEnabled = $state(preferences.freesoundLibraryEnabled);
  let freesoundSourceEnabled = $state(preferences.freesoundLibraryEnabled && preferences.freesoundSourceEnabled);
  let freesoundStatus = $state<"idle" | "loading" | "ready" | "error">("idle");
  let freesoundError = $state("");
  let freesoundTotal = $state(0);
  let freesoundPage = $state(1);
  let freesoundHasNext = $state(false);
  let freesoundRefreshNonce = $state(0);
  let selectedId = $state(browserDemoSound?.id || "");
  let folderQuery = $state("");
  let tabs = $state<SearchTab[]>(createLibraryTabs());
  let activeTabId = $state("search-library");
  let filter = $state("all");
  let sortMode = $state<SortMode>("relevance");
  let labelFilter = $state<LabelColor | undefined>(undefined);
  let compactResults = $state(true);
  let playing = $state(false);
  let progress = $state(0);
  let processing = $state<AudioProcessingSettings>({ ...DEFAULT_AUDIO_PROCESSING });
  let processingPreviewUrl = $state("");
  let processingPreviewScope = $state<AudioSegmentSelection | null>(null);
  let processingPreviewBusy = $state(false);
  let processingPreviewError = $state("");
  let loop = $state(preferences.loop);
  let insertionTarget = $state<InsertionTarget>(preferences.insertionTarget);
  let zoom = $state(1);
  let previewChannels = $state<Float32Array[]>([]);
  let waveformChannelsLoading = $state(false);
  let segmentSelection = $state<AudioSegmentSelection | null>(null);
  let preparedSegment = $state<SoundFile | null>(null);
  let segmentPreparing = $state(false);
  let isIndexing = $state(false);
  let indexProgress = $state<ScanProgress>({ files: 0, folders: 0, currentPath: "" });
  let insertBusy = $state(false);
  let sidebarOpen = $state(false);
  let sidebarPinned = $state(readSidebarPin());
  let includeSubfolders = $state(true);
  let compactPreviewOpen = $state(false);
  let gridView = $state(browsePreference("view", "list") === "grid");
  let tileSize = $state(Math.max(120, Math.min(240, Number(browsePreference("tile-size", "160")) || 160)));
  let hoverPreview = $state(browsePreference("hover", "false") === "true");
  let collections = $state<FavoriteCollection[]>(loadFavoriteCollections());
  let favoriteCollection = $state("all");
  let favoriteEditing = $state<SoundFile | null>(null);
  let savedCloudFavorites = $state<SoundFile[]>(loadCloudFavorites());
  let resultsViewportWidth = $state(500);
  let toolbarWidth = $state(500);
  $effect(() => {
    const values = { view: gridView ? "grid" : "list", "tile-size": String(tileSize), hover: String(hoverPreview) };
    try { for (const [key, value] of Object.entries(values)) localStorage.setItem(`sounddesigner.browse.${key}`, value); } catch (_) {}
  });
  let settingsOpen = $state(false);
  let storageInfo = $state<PlatformStorageInfo | null>(null);
  let storageBusy = $state(false);
  let portablePreferencesReady = $state(!platform().capabilities.nativeStorage);
  let sfxAssistantOpen = $state(false);
  let settingsFolderId = $state<string | null>(null);
  let autoPreview = $state(preferences.autoPreview);
  let conversionPolicy = $state<AudioConversionPolicy>(preferences.conversionPolicy);
  let normalization = $state<AudioNormalization>(preferences.normalization);
  let normalizationTargetDb = $state(preferences.normalizationTargetDb);
  let freesoundApiKey = $state(preferences.freesoundApiKey);
  let credentialsReady = $state(!platform().capabilities.nativeStorage);
  let credentialWritePending = false;
  let credentialRevision = 0;
  const refreshFreesoundApiKey = async () => {
    if (!platform().capabilities.nativeStorage || credentialWritePending) return;
    const revision = ++credentialRevision;
    const result = await platform().storage.getFreesoundApiKey(credentialsReady ? "" : preferences.freesoundApiKey);
    if (revision !== credentialRevision) return;
    if (!result.ok) { notify("error", result.error.message); return; }
    freesoundApiKey = result.data;
    credentialsReady = true;
  };
  const saveFreesoundApiKey = async (value: string) => {
    if (!platform().capabilities.nativeStorage) { freesoundApiKey = value.trim(); return; }
    credentialRevision += 1;
    credentialWritePending = true;
    try {
      const result = await platform().storage.saveFreesoundApiKey(value);
      if (!result.ok) { notify("error", result.error.message); return; }
      freesoundApiKey = value.trim();
      credentialsReady = true;
    } finally { credentialWritePending = false; }
  };
  onMount(() => {
    void refreshFreesoundApiKey();
    const refresh = () => { if (!document.hidden) void refreshFreesoundApiKey(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      credentialRevision += 1;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  });
  let freesoundLicenseFilter = $state<FreesoundLicenseFilter>(preferences.freesoundLicenseFilter);
  let toasts = $state<ToastMessage[]>([]);
  let soundPreparation = $state<Record<string, AudioPreparationStatus | undefined>>({});
  let updateState = $state<UpdateState>({ status: "idle", currentVersion: INSTALLED_VERSION });
  let updateDismissed = $state(false);
  let floatingTooltip = $state<{ text: string; x: number; y: number; above: boolean } | null>(null);
  let now = $state(Date.now());
  let searchInput: HTMLInputElement;
  let resultsList: HTMLDivElement;
  let resultsScrollTop = $state(0);
  let resultsViewportHeight = $state(600);
  let resultRowHeight = $state(resultRowHeightForViewport(true));
  let pendingResultsScrollTop = 0;
  let resultsScrollFrame = 0;
  let libraryWidth = $state(loadLibraryWidth());
  let effectsOpen = $state(false);

  let audio: HTMLAudioElement | null = null;
  let hoverAudio: HTMLAudioElement | null = null;
  let hoverController: AbortController | null = null;
  let hoverTimer = 0;
  let hoverGeneration = 0;
  let hoverSoundId = "";
  const stopHover = () => {
    hoverGeneration += 1;
    hoverController?.abort();
    hoverController = null;
    window.clearTimeout(hoverTimer);
    hoverTimer = 0;
    hoverSoundId = "";
    if (hoverAudio) { hoverAudio.pause(); hoverAudio.removeAttribute("src"); hoverAudio.load(); hoverAudio = null; }
  };
  const auditionHover = (sound: SoundFile) => {
    stopHover();
    if (!hoverPreview || favoriteEditing || settingsOpen) return;
    const generation = hoverGeneration;
    hoverSoundId = sound.id;
    hoverTimer = window.setTimeout(async () => {
      try {
        const controller = new AbortController();
        hoverController = controller;
        const url = sound.path ? fileUrl(sound.path) : sound.previewUrl || (sound.source === "scorpion" ? await resolveCloudPreview(sound, controller.signal) : "");
        if (!url || generation !== hoverGeneration || !hoverPreview) return;
        if (audio) audio.pause();
        const next = new Audio(url);
        next.volume = audio?.volume ?? 0.8;
        hoverAudio = next;
        await next.play();
        if (generation !== hoverGeneration) { next.pause(); next.removeAttribute("src"); next.load(); }
      } catch (_) { /* Hover audition is optional; explicit Play reports failures. */ }
    }, 350);
  };
  $effect(() => { if (!hoverPreview) untrack(stopHover); });
  onMount(() => () => stopHover());
  onMount(() => platform().audio.onDragError((error) => notify("error", error.message)));
  let audioPreviewScope: AudioSegmentSelection | null = null;
  let audioUsesProcessedPreview = false;
  let audioSoundId = "";
  let pendingPlayId: string | null = null;
  let sourceSwapWasPlaying = false;
  let sourceSwapProgress = 0;
  let toastId = 0;
  let tooltipTimer: number | null = null;
  let tooltipHideTimer: number | null = null;
  let persistedLibrarySignature = "";
  let libraryRestoreInProgress = false;
  let librarySyncInitialized = false;
  let afterEffectsDragSession: AfterEffectsDragSession | null = null;
  let afterEffectsDragSessionId = 0;
  let preparationDragSession: PreparationDragSession | null = null;
  let preparationDragSessionId = 0;
  let segmentDragPreparation: Promise<SoundFile | null> | null = null;
  let segmentDragLeftPanel = false;
  let segmentDragCancelled = false;
  let activeProjectPath = "";
  let freesoundSearchController: AbortController | null = null;
  let freesoundSearchGeneration = 0;
  let segmentPreparationGeneration = 0;
  let processingPreparationTimer = 0;
  let waveformAnalysisTimer = 0;
  let waveformAnalysisBusy = false;
  const waveformAnalysisQueue: string[] = [];
  const waveformAnalysisQueued = new Set<string>();
  const waveformAnalysisPriority = new Set<string>();
  const freesoundSessionCache = new Map<string, SoundFile>();
  const preparingSounds = new Map<string, Promise<SoundFile>>();
  const preparedProcessingCache = new Map<string, SoundFile>();
  const preparedSegmentCache = new Map<string, SoundFile>();
  const soundSearchTextCache = new WeakMap<SoundFile, string>();
  let segmentPreparationController: AbortController | null = null;
  let activeSegmentPreparationKey = "";
  let activeSegmentPreparation: Promise<SoundFile> | null = null;

  const cachePreparedProcessing = (key: string, sound: SoundFile) => {
    // Continuous slider adjustments can produce many distinct profiles. Keep
    // the UI cache bounded; rendered files remain in project storage.
    preparedProcessingCache.delete(key);
    preparedProcessingCache.set(key, sound);
    while (preparedProcessingCache.size > 32) {
      const oldestKey = preparedProcessingCache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      preparedProcessingCache.delete(oldestKey);
    }
  };

  const getCachedProcessing = (key: string) => {
    const cached = preparedProcessingCache.get(key);
    if (cached) cachePreparedProcessing(key, cached);
    return cached;
  };

  const cancelSegmentPreparation = () => {
    segmentPreparationController?.abort();
    segmentPreparationController = null;
    activeSegmentPreparationKey = "";
    activeSegmentPreparation = null;
    segmentPreparationGeneration += 1;
    segmentPreparing = false;
  };

  const invalidatePreparedSegment = () => {
    preparedSegment = null;
    cancelSegmentPreparation();
  };

  const soundSearchText = (sound: SoundFile) => {
    const cached = soundSearchTextCache.get(sound);
    if (cached) return cached;
    const text = `${sound.name} ${sound.tags.join(" ")} ${sound.extension}`.toLowerCase();
    soundSearchTextCache.set(sound, text);
    return text;
  };

  const mergeFreesoundSessionState = (sound: SoundFile) => {
    const cached = freesoundSessionCache.get(sound.id);
    if (!cached) return sound;
    return {
      ...sound,
      favorite: cached.favorite,
      favoriteCollection: cached.favoriteCollection,
      labelColor: cached.labelColor,
      previewUrl: cached.previewUrl || sound.previewUrl,
      path: cached.path,
      extension: cached.path ? cached.extension : sound.extension,
      size: cached.path ? cached.size : sound.size,
      modifiedAt: cached.path ? cached.modifiedAt : sound.modifiedAt,
      downloadState: cached.downloadState,
      preparedProjectPath: cached.preparedProjectPath,
      preparedProfile: cached.preparedProfile,
      originalPath: cached.originalPath,
      originalExtension: cached.originalExtension,
    };
  };

  const hydrateFreesoundResults = (nextSounds: SoundFile[]) =>
    hydrateLibraryMetadata([], nextSounds).sounds.map(mergeFreesoundSessionState);

  let activeTab = $derived(tabs.find((tab) => tab.id === activeTabId) || tabs[0]);
  let selectedFolder = $derived(activeTab?.folderId || "all");
  let folderNodesById = $derived.by(() => {
    const nodes = new Map<string, LibraryFolder["tree"]>();
    for (const folder of folders) {
      const pending = [folder.tree];
      while (pending.length) {
        const node = pending.pop();
        if (!node) continue;
        nodes.set(node.id, node);
        for (const child of node.children) pending.push(child);
      }
    }
    return nodes;
  });
  const folderNameForId = (folderId: string) => folderNodesById.get(folderId)?.name || "";
  let folderBreadcrumb = $derived.by(() => {
    const node = folderNodesById.get(selectedFolder);
    if (!node) return "All sounds";
    const root = folders.find((folder) => folder.tree.id === node.rootId || folder.tree.id === node.id);
    if (!root || node.id === root.tree.id) return node.name;
    const relative = node.path.replace(/\\/g, "/").slice(root.path.replace(/\\/g, "/").length).replace(/^\/+/, "");
    return `${root.name} / ${relative.split("/").join(" / ")}`;
  });
  const setActiveTabFolder = (folderId: string) => {
    tabs = updateSearchTabFolder(tabs, activeTabId, folderId, folderNameForId);
  };
  let cloudSourceActive = $derived((selectedFolder === "all" || filter === "favorites") && (cloudLibraryEnabled || (freesoundLibraryEnabled && freesoundSourceEnabled)));
  let selected = $derived(sounds.find((sound) => sound.id === selectedId) || freesoundSounds.find((sound) => sound.id === selectedId) || savedCloudFavorites.find(sound => sound.id === selectedId) || null);
  let settingsFolder = $derived(folders.find((folder) => folder.id === settingsFolderId) || null);
  let favoriteCount = $derived(new Set([...sounds, ...freesoundSounds, ...savedCloudFavorites].filter((sound) => sound.favorite).map(sound => sound.id)).size);
  let selectedDirectoryIds = $derived.by(() => {
    const ids = new Set<string>();
    if (selectedFolder === "all") return ids;
    const node = folderNodesById.get(selectedFolder);
    if (node) {
      ids.add(node.id);
      if (includeSubfolders) collectTreeIds(node, ids);
    }
    return ids;
  });
  let localVisibleSounds = $derived.by(() => {
    if (!localSourceEnabled) return [];
    const queryTokens = (activeTab?.query || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
    return sounds.filter((sound) => {
      if (filter !== "favorites" && selectedFolder !== "all" && !selectedDirectoryIds.has(sound.directoryId)) return false;
      if (filter === "favorites" && !sound.favorite) return false;
      if (filter === "favorites" && favoriteCollection !== "all" && (sound.favoriteCollection || "") !== favoriteCollection) return false;
      if (filter === "ambience" && !sound.tags.includes("ambience") && sound.duration < 10) return false;
      if (filter === "one-shot" && sound.duration > 8) return false;
      if (labelFilter && sound.labelColor !== labelFilter) return false;
      if (!queryTokens.length) return true;
      const haystack = soundSearchText(sound);
      return queryTokens.every((token) => haystack.includes(token));
    });
  });
  let cloudBrowseSounds = $derived(filter === "favorites" ? [...new Map([...savedCloudFavorites, ...freesoundSounds.filter(sound => sound.favorite)].map(sound => [sound.id, sound])).values()] : freesoundSounds);
  let freesoundVisibleSounds = $derived(cloudSourceActive && (selectedFolder === "all" || filter === "favorites") ? cloudBrowseSounds.filter((sound) => {
    if (filter === "favorites" && !sound.favorite) return false;
    if (filter === "favorites" && favoriteCollection !== "all" && (sound.favoriteCollection || "") !== favoriteCollection) return false;
    if (filter === "favorites" && !(activeTab?.query || "").toLowerCase().trim().split(/\s+/).filter(Boolean).every(token => soundSearchText(sound).includes(token))) return false;
    if (filter === "ambience" && !sound.tags.includes("ambience") && sound.duration < 10) return false;
    if (filter === "one-shot" && sound.duration > 8) return false;
    if (labelFilter && sound.labelColor !== labelFilter) return false;
    return true;
  }) : []);
  let visibleSounds = $derived.by(() => {
    const combined = [...localVisibleSounds, ...freesoundVisibleSounds];
    if (sortMode === "name") return combined.sort((first, second) => first.name.localeCompare(second.name));
    if (sortMode === "duration") return combined.sort((first, second) => (second.duration || 0) - (first.duration || 0));
    if (sortMode === "label") return combined.sort((first, second) =>
      labelColorOrder(first.labelColor) - labelColorOrder(second.labelColor) || first.name.localeCompare(second.name));
    return combined;
  });
  let sortLabel = $derived(sortMode === "name" ? "Name" : sortMode === "duration" ? "Duration" : sortMode === "label" ? "Label" : "Default");
  let searchPlaceholder = $derived(localSourceEnabled && cloudSourceActive
    ? "Search local and cloud sounds…"
    : cloudSourceActive ? "Search cloud sounds…" : "Search local sounds…");
  let virtualizedResults = $derived(visibleSounds.length > VIRTUALIZATION_THRESHOLD);
  let gridColumns = $derived(gridView ? Math.max(1, Math.floor((resultsViewportWidth - 18 + 8) / (tileSize + 8))) : 1);
  let virtualRowHeight = $derived(gridView ? 138 : resultRowHeight);
  let virtualStart = $derived.by(() => {
    if (!virtualizedResults) return 0;
    const start = Math.max(0, Math.floor(resultsScrollTop / virtualRowHeight) - VIRTUAL_OVERSCAN) * gridColumns;
    return Math.min(start, Math.max(0, Math.floor((visibleSounds.length - 1) / gridColumns) * gridColumns));
  });
  let virtualEnd = $derived.by(() => {
    if (!virtualizedResults) return visibleSounds.length;
    return Math.min(
      visibleSounds.length,
      (Math.ceil((resultsScrollTop + resultsViewportHeight) / virtualRowHeight) + VIRTUAL_OVERSCAN) * gridColumns,
    );
  });
  let renderedSounds = $derived(visibleSounds.slice(virtualStart, virtualEnd));
  let virtualTopSpace = $derived(virtualizedResults ? Math.floor(virtualStart / gridColumns) * virtualRowHeight : 0);
  let virtualBottomSpace = $derived(virtualizedResults ? Math.max(0, Math.ceil((visibleSounds.length - virtualEnd) / gridColumns) * virtualRowHeight) : 0);

  const notify = (type: ToastMessage["type"], message: string) => {
    const id = ++toastId;
    toasts = [...toasts.slice(-2), { id, type, message }];
    window.setTimeout(() => { toasts = toasts.filter((item) => item.id !== id); }, 3200);
  };

  const persistLibraryFolders = (nextFolders: LibraryFolder[]) => {
    persistedLibrarySignature = JSON.stringify(saveLibraryPaths(nextFolders));
  };

  const commitRealWaveform = (sound: SoundFile, channels: Float32Array[]) => {
    if (!channels.length) return;
    const compact = compactWaveformFromChannels(channels);
    if (compact.length < 2) return;
    const current = sounds.find((item) => item.id === sound.id);
    if (!current) return;
    current.waveform = compact;
    current.waveformReal = true;
    saveSoundMetadata(current, { waveform: compact });
  };

  const scheduleWaveformAnalysis = (delay = 650) => {
    if (waveformAnalysisTimer || waveformAnalysisBusy || !waveformAnalysisQueue.length) return;
    waveformAnalysisTimer = window.setTimeout(async () => {
      waveformAnalysisTimer = 0;
      if (document.hidden || isIndexing) {
        scheduleWaveformAnalysis(1200);
        return;
      }
      const soundId = waveformAnalysisQueue.shift();
      if (!soundId) return;
      waveformAnalysisQueued.delete(soundId);
      waveformAnalysisPriority.delete(soundId);
      const sound = sounds.find((item) => item.id === soundId);
      if (!sound || !sound.path || sound.waveformReal || sound.size > 32 * 1024 * 1024 || sound.duration > 120) {
        scheduleWaveformAnalysis(waveformAnalysisPriority.has(waveformAnalysisQueue[0] || "") ? 40 : 160);
        return;
      }
      waveformAnalysisBusy = true;
      try {
        const channels = await decodeAudioWaveformChannels(sound.path, sound.size, sound.modifiedAt, sound.duration);
        commitRealWaveform(sound, channels);
      } finally {
        waveformAnalysisBusy = false;
        scheduleWaveformAnalysis(waveformAnalysisPriority.has(waveformAnalysisQueue[0] || "") ? 80 : playing ? 1100 : 650);
      }
    }, delay);
  };

  const enqueueWaveformAnalysis = (candidates: SoundFile[], priority = false) => {
    const ids: string[] = [];
    for (const sound of candidates) {
      if (!sound.path || isCloudSound(sound) || sound.waveformReal) continue;
      if (waveformAnalysisQueued.has(sound.id)) {
        if (priority) {
          const queuedIndex = waveformAnalysisQueue.indexOf(sound.id);
          if (queuedIndex >= 0) waveformAnalysisQueue.splice(queuedIndex, 1);
          waveformAnalysisPriority.add(sound.id);
          ids.push(sound.id);
        }
        continue;
      }
      waveformAnalysisQueued.add(sound.id);
      if (priority) waveformAnalysisPriority.add(sound.id);
      ids.push(sound.id);
    }
    if (priority) waveformAnalysisQueue.unshift(...ids);
    else waveformAnalysisQueue.push(...ids);
    if (priority && ids.length && waveformAnalysisTimer) {
      window.clearTimeout(waveformAnalysisTimer);
      waveformAnalysisTimer = 0;
    }
    scheduleWaveformAnalysis(priority ? 30 : 650);
  };

  const setLibraryWidth = (value: number, persist = false) => {
    libraryWidth = clampLibraryWidth(value);
    if (persist) saveLibraryWidth(libraryWidth);
  };

  const startLibraryResize = (event: MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = document.querySelector(".library-panel")?.getBoundingClientRect().width || libraryWidth;
    let pendingWidth = startWidth;
    let resizeFrame = 0;
    let finished = false;
    let move: (nextEvent: MouseEvent) => void;
    document.documentElement.classList.add("is-resizing-library");

    const finish = () => {
      if (finished) return;
      finished = true;
      if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = 0;
        setLibraryWidth(pendingWidth);
      }
      saveLibraryWidth(libraryWidth);
      document.documentElement.classList.remove("is-resizing-library");
      window.removeEventListener("mousemove", move, true);
      window.removeEventListener("mouseup", finish, true);
      window.removeEventListener("blur", finish);
    };
    move = (nextEvent: MouseEvent) => {
      if ((nextEvent.buttons & 1) === 0) {
        finish();
        return;
      }
      nextEvent.preventDefault();
      pendingWidth = startWidth + nextEvent.clientX - startX;
      if (resizeFrame) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = 0;
        setLibraryWidth(pendingWidth);
      });
    };
    window.addEventListener("mousemove", move, true);
    window.addEventListener("mouseup", finish, true);
    window.addEventListener("blur", finish);
  };

  const handleResultsScroll = (event: Event & { currentTarget: HTMLDivElement }) => {
    pendingResultsScrollTop = event.currentTarget.scrollTop;
    if (resultsScrollFrame) return;
    resultsScrollFrame = window.requestAnimationFrame(() => {
      resultsScrollFrame = 0;
      resultsScrollTop = pendingResultsScrollTop;
    });
  };

  const toggleResultDensity = () => {
    compactResults = !compactResults;
    resultRowHeight = resultRowHeightForViewport(compactResults);
    resultsScrollTop = 0;
    pendingResultsScrollTop = 0;
    resultsList?.scrollTo(0, 0);
  };

  const cycleSortMode = () => {
    sortMode = sortMode === "relevance" ? "name" : sortMode === "name" ? "duration" : sortMode === "duration" ? "label" : "relevance";
    resultsScrollTop = 0;
    pendingResultsScrollTop = 0;
    resultsList?.scrollTo(0, 0);
  };

  const resizeLibraryWithKeyboard = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") setLibraryWidth(libraryWidth - 12, true);
    else if (event.key === "ArrowRight") setLibraryWidth(libraryWidth + 12, true);
    else if (event.key === "Home") setLibraryWidth(LIBRARY_MIN_WIDTH, true);
    else if (event.key === "End") setLibraryWidth(LIBRARY_MAX_WIDTH, true);
    else return;
    event.preventDefault();
  };

  const refreshUpdates = async () => {
    updateState = { ...updateState, status: "checking", message: "Checking GitHub…" };
    const next = await checkForUpdates(true);
    updateState = next;
    updateDismissed = isUpdateDismissed(next.latestVersion);
    notify(next.status === "available" ? "success" : next.status === "error" ? "warning" : "info", next.message || "Update check finished.");
  };

  const portablePreferences = (): PlatformPortablePreferences => ({
    autoPreview,
    loop,
    localSourceEnabled,
    cloudLibraryEnabled,
    freesoundLibraryEnabled,
    freesoundSourceEnabled,
    insertionTarget,
    conversionPolicy,
    normalization,
    normalizationTargetDb,
    freesoundLicenseFilter,
  });

  const applyPortablePreferences = (stored: PlatformPortablePreferences) => {
    autoPreview = stored.autoPreview;
    loop = stored.loop;
    localSourceEnabled = stored.localSourceEnabled;
    cloudLibraryEnabled = stored.cloudLibraryEnabled;
    freesoundLibraryEnabled = stored.freesoundLibraryEnabled;
    freesoundSourceEnabled = stored.freesoundSourceEnabled;
    insertionTarget = stored.insertionTarget;
    conversionPolicy = stored.conversionPolicy;
    normalization = stored.normalization;
    normalizationTargetDb = normalizeTargetDb(stored.normalizationTargetDb);
    freesoundLicenseFilter = stored.freesoundLicenseFilter;
  };

  const changeStorageLocation = async () => {
    if (storageBusy) return;
    storageBusy = true;
    try {
      const result = await platform().storage.changeLocation();
      if (!result.ok) { notify("error", result.error.message); return; }
      if (!result.data) { notify("info", "Storage location was not changed."); return; }
      storageInfo = result.data;
      portablePreferencesReady = false;
      const stored = await platform().storage.getPreferences();
      if (stored.ok && stored.data) applyPortablePreferences(stored.data);
      await loadPortableLibraryMetadata();
      collections = loadFavoriteCollections();
      savedCloudFavorites = loadCloudFavorites();
      if (platform().capabilities.nativeLibrary) {
        const library = await platform().library.getSnapshot();
        if (library.ok) applyNativeLibrarySnapshot(library.data);
        else notify("warning", library.error.message);
      }
      portablePreferencesReady = true;
      if (stored.ok && !stored.data) await platform().storage.savePreferences(portablePreferences());
      notify("success", "SoundDesigner storage location updated.");
    } finally {
      storageBusy = false;
    }
  };

  const openUpdate = () => {
    const url = updateState.downloadUrl || updateState.releaseUrl;
    if (!url) {
      notify("warning", "No trusted GitHub release download is available yet.");
      return;
    }
    void platform().runtime.openExternal(url);
  };

  const dismissAvailableUpdate = () => {
    if (!updateState.latestVersion) return;
    dismissUpdate(updateState.latestVersion);
    updateDismissed = true;
  };

  const togglePlay = () => {
    stopHover();
    if ((!selected?.path && !selected?.previewUrl) || !audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (!audioUsesProcessedPreview && segmentSelection && audio.duration) {
      const start = Math.max(0, Math.min(audio.duration, segmentSelection.start));
      const end = Math.max(start, Math.min(audio.duration, segmentSelection.end));
      if (audio.currentTime < start || audio.currentTime >= end - 0.01) {
        audio.currentTime = start;
        progress = start / audio.duration;
      }
    }
    if (audioUsesProcessedPreview && audio.currentTime >= audio.duration - 0.01) audio.currentTime = 0;
    audio.play().catch(() => {
      playing = false;
      notify("error", "Audio preview could not start.");
    });
  };

  const stopPlayback = () => {
    stopHover();
    if (audio) {
      audio.pause();
      audio.currentTime = audioUsesProcessedPreview ? 0 : segmentSelection?.start || 0;
    }
    playing = false;
    progress = selected?.duration ? (audioPreviewScope?.start || segmentSelection?.start || 0) / selected.duration : 0;
  };

  const updateProcessing = (patch: Partial<AudioProcessingSettings>) => {
    processing = normalizeAudioProcessing({ ...processing, ...patch });
    preparedSegment = null;
    cancelSegmentPreparation();
    window.clearTimeout(processingPreparationTimer);
    const activeSelection = segmentSelection ? { ...segmentSelection } : null;
    if (activeSelection && (window.cep || platform().capabilities.nativeAudioPreparation) && host !== "browser") {
      processingPreparationTimer = window.setTimeout(() => prepareSelectedSegment(activeSelection, false), 320);
    }
  };

  $effect(() => savePreferences(
    autoPreview,
    loop,
    insertionTarget,
    localSourceEnabled,
    freesoundLibraryEnabled,
    freesoundSourceEnabled,
    conversionPolicy,
    normalization,
    normalizationTargetDb,
    freesoundApiKey,
    freesoundLicenseFilter,
  ));
  $effect(() => {
    if (!portablePreferencesReady || !platform().capabilities.nativeStorage) return;
    const value = portablePreferences();
    const timer = window.setTimeout(() => {
      void platform().storage.savePreferences(value).then((result) => {
        if (!result.ok) notify("warning", result.error.message);
      });
    }, 120);
    return () => window.clearTimeout(timer);
  });
  $effect(() => { if (audio) audio.loop = loop && (audioUsesProcessedPreview || !segmentSelection); });
  $effect(() => {
    const current = selected;
    previewChannels = [];
    waveformChannelsLoading = Boolean(current?.path || current?.previewUrl);
    if (!current?.path && !current?.previewUrl) return;
    let cancelled = false;
    const stillSelected = () => !cancelled && selectedId === current.id;
    const decodeTimer = window.setTimeout(() => {
      const decoding = current.path
        ? decodeAudioWaveformChannels(
          current.path,
          current.size,
          current.modifiedAt,
          current.duration,
          stillSelected,
        )
        : decodeRemoteAudioWaveformChannels(current.previewUrl || "", current.duration, stillSelected);
      decoding.then((channels) => {
        if (stillSelected()) {
          previewChannels = channels;
          waveformChannelsLoading = false;
          if (current.path && !isCloudSound(current)) commitRealWaveform(current, channels);
        }
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(decodeTimer);
    };
  });
  $effect(() => {
    // Searches and folder/filter changes begin at the top, matching the existing list behavior.
    activeTabId;
    activeTab?.query;
    filter;
    labelFilter;
    selectedFolder;
    untrack(() => {
      resultsScrollTop = 0;
      resultsList?.scrollTo(0, 0);
    });
  });

  $effect(() => {
    const visibleLocalSounds = renderedSounds.filter((sound) => !isCloudSound(sound));
    untrack(() => enqueueWaveformAnalysis(visibleLocalSounds, true));
  });

  $effect(() => {
    if (!visibleSounds.length) {
      if (selectedId) selectedId = "";
      return;
    }
    if (selectedId && !visibleSounds.some((sound) => sound.id === selectedId)) selectedId = "";
  });

  $effect(() => {
    selectedId;
    untrack(() => {
      processing = { ...DEFAULT_AUDIO_PROCESSING };
      if (processingPreviewUrl) URL.revokeObjectURL(processingPreviewUrl);
      processingPreviewUrl = "";
      processingPreviewScope = null;
      processingPreviewBusy = false;
      processingPreviewError = "";
    });
  });

  $effect(() => {
    const current = selected;
    const profile = audioProcessingKey(processing);
    const active = hasAudioProcessing(processing);
    const scope = segmentSelection ? { ...segmentSelection } : null;
    const scopeKey = scope ? `${scope.start.toFixed(4)}:${scope.end.toFixed(4)}` : "full";
    profile;
    scopeKey;
    let cancelled = false;
    let generatedUrl = "";
    let controller: AbortController | null = null;
    let timer = 0;
    untrack(() => {
      processingPreviewBusy = Boolean(active && current && (current.path || current.previewUrl));
      processingPreviewError = "";
      if (!active || !current) {
        const retiredUrl = processingPreviewUrl;
        processingPreviewUrl = "";
        processingPreviewScope = null;
        if (retiredUrl) window.setTimeout(() => URL.revokeObjectURL(retiredUrl), 1200);
      }
    });
    if (!active || !current || (!current.path && !current.previewUrl)) return;
    timer = window.setTimeout(async () => {
      controller = new AbortController();
      try {
        const rendered = await renderProcessedPreview(current, scope, processing, controller.signal);
        generatedUrl = rendered.url;
        if (cancelled || selectedId !== current.id || audioProcessingKey(processing) !== profile) {
          URL.revokeObjectURL(generatedUrl);
          generatedUrl = "";
          return;
        }
        const retiredUrl = processingPreviewUrl;
        processingPreviewUrl = generatedUrl;
        generatedUrl = "";
        processingPreviewScope = scope;
        processingPreviewBusy = false;
        if (retiredUrl) window.setTimeout(() => URL.revokeObjectURL(retiredUrl), 1200);
      } catch (error) {
        const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
        if (!aborted && !cancelled) {
          const retiredUrl = processingPreviewUrl;
          processingPreviewUrl = "";
          processingPreviewScope = null;
          processingPreviewBusy = false;
          processingPreviewError = error instanceof Error ? error.message : "The processed preview could not be rendered.";
          if (retiredUrl) window.setTimeout(() => URL.revokeObjectURL(retiredUrl), 1200);
        }
      }
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller?.abort();
      if (generatedUrl) URL.revokeObjectURL(generatedUrl);
    };
  });

  $effect(() => {
    const cloudEnabled = cloudSourceActive && (selectedFolder === "all" || filter === "favorites");
    const includeLibrary = cloudLibraryEnabled;
    const includeFreesound = freesoundLibraryEnabled && freesoundSourceEnabled;
    const query = activeTab?.query.trim() || "";
    const apiKey = freesoundApiKey;
    const licenseFilter = freesoundLicenseFilter;
    freesoundRefreshNonce;
    if (!cloudEnabled) {
      freesoundSearchController?.abort();
      freesoundSearchController = null;
      freesoundSounds = [];
      freesoundTotal = 0;
      freesoundHasNext = false;
      freesoundStatus = "idle";
      freesoundError = "";
      return;
    }
    freesoundSearchController?.abort();
    freesoundSearchController = null;
    // Retire results before the debounce, not after the next request completes.
    freesoundSounds = [];
    freesoundTotal = 0;
    freesoundHasNext = false;
    freesoundStatus = query.length >= 2 ? "loading" : "idle";
    if (!includeLibrary && !apiKey) {
      freesoundSounds = [];
      freesoundTotal = 0;
      freesoundHasNext = false;
      freesoundStatus = "idle";
      freesoundError = "Add your Freesound API key in Settings to search the cloud library.";
      return;
    }
    if (query.length < 2) {
      freesoundSounds = [];
      freesoundTotal = 0;
      freesoundHasNext = false;
      freesoundStatus = "idle";
      freesoundError = "Type at least two characters to search the cloud library.";
      return;
    }
    const controller = new AbortController();
    const generation = ++freesoundSearchGeneration;
    freesoundSearchController = controller;
    const timer = window.setTimeout(() => {
      freesoundStatus = "loading";
      freesoundError = "";
      searchSoundSources(query, apiKey, licenseFilter, 1, includeLibrary, includeFreesound, controller.signal).then((page) => {
        if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
        freesoundSounds = hydrateFreesoundResults(page.sounds);
        freesoundTotal = page.total;
        freesoundPage = page.page;
        freesoundHasNext = page.hasNext;
        freesoundStatus = "ready";
        const selectedStillVisible = (localSourceEnabled && sounds.some((sound) => sound.id === selectedId))
          || page.sounds.some((sound) => sound.id === selectedId);
        if (!selectedStillVisible) selectedId = "";
      }).catch((error) => {
        if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
        freesoundSounds = [];
        freesoundTotal = 0;
        freesoundHasNext = false;
        freesoundStatus = "error";
        freesoundError = error && typeof error === "object" && "message" in error
          ? String(error.message) : "Cloud search failed.";
        notify("warning", freesoundError);
      });
    }, 420);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  });

  $effect(() => {
    const sound = selected;
    if (sound?.source !== "scorpion" || sound.previewUrl || sound.path) return;
    const controller = new AbortController();
    resolveCloudPreview(sound, controller.signal).then(previewUrl => {
      if (!controller.signal.aborted) updateSoundRecord({ ...sound, previewUrl });
    }).catch(error => { if (!controller.signal.aborted) notify("warning", error.message || "Cloud preview unavailable."); });
    return () => controller.abort();
  });

  $effect(() => {
    const currentIndex = visibleSounds.findIndex(sound => sound.id === selectedId);
    const nextSound = currentIndex >= 0 ? visibleSounds[(currentIndex + 1) % visibleSounds.length] : null;
    if (!nextSound || nextSound.id === selectedId || !isCloudSound(nextSound) || nextSound.path) return;
    const controller = new AbortController();
    let warmAudio: HTMLAudioElement | null = null;
    const timer = window.setTimeout(async () => {
      try {
        const previewUrl = nextSound.previewUrl || (nextSound.source === "scorpion" ? await resolveCloudPreview(nextSound, controller.signal) : "");
        if (controller.signal.aborted || !previewUrl) return;
        warmAudio = new Audio(previewUrl);
        warmAudio.preload = "metadata";
        warmAudio.load();
      } catch (_) { /* Prefetch is optional; explicit playback reports failures. */ }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
      if (warmAudio) { warmAudio.removeAttribute("src"); warmAudio.load(); }
    };
  });

  $effect(() => {
    const id = selectedId;
    selected?.previewUrl;
    const renderedPreviewUrl = processingPreviewUrl;
    const renderedPreviewScope = processingPreviewScope;
    const currentSelected = untrack(() => sounds.find((sound) => sound.id === id) || freesoundSounds.find((sound) => sound.id === id) || null);
    const soundChanged = audioSoundId !== id;
    const shouldResume = !soundChanged && sourceSwapWasPlaying;
    const retainedProgress = !soundChanged ? sourceSwapProgress : 0;
    sourceSwapWasPlaying = false;
    sourceSwapProgress = 0;
    if (audio) {
      audio.pause();
      audio = null;
    }
    playing = shouldResume;
    progress = retainedProgress;
    if (soundChanged) {
      audioSoundId = id;
      playing = false;
      progress = 0;
      segmentSelection = null;
      preparedSegment = null;
      cancelSegmentPreparation();
    }
    audioPreviewScope = null;
    audioUsesProcessedPreview = false;

    const startPendingPreview = () => {
      if (currentSelected && pendingPlayId === currentSelected.id) {
        pendingPlayId = null;
        window.setTimeout(togglePlay, 0);
      }
    };
    const previewSource = renderedPreviewUrl || (currentSelected?.path ? fileUrl(currentSelected.path) : currentSelected?.previewUrl || "");
    if (!previewSource) {
      if (currentSelected?.source === "scorpion") return;
      startPendingPreview();
      return;
    }

    const nextAudio = new Audio(previewSource);
    const usesProcessedPreview = Boolean(renderedPreviewUrl);
    const activePreviewScope = usesProcessedPreview ? renderedPreviewScope : null;
    audioPreviewScope = activePreviewScope;
    audioUsesProcessedPreview = usesProcessedPreview;
    let playbackFrame = 0;
    nextAudio.preload = "metadata";
    nextAudio.volume = 1;
    nextAudio.loop = untrack(() => loop && (usesProcessedPreview || !segmentSelection));
    const onTimeUpdate = () => {
      if (!nextAudio.duration) return;
      if (usesProcessedPreview) {
        if (activePreviewScope && currentSelected?.duration) {
          const ratio = Math.max(0, Math.min(1, nextAudio.currentTime / nextAudio.duration));
          progress = (activePreviewScope.start + ratio * (activePreviewScope.end - activePreviewScope.start)) / currentSelected.duration;
        } else progress = nextAudio.currentTime / nextAudio.duration;
        return;
      }
      const activeSelection = segmentSelection;
      if (activeSelection && nextAudio.currentTime < activeSelection.start - 0.008) {
        nextAudio.currentTime = activeSelection.start;
        progress = activeSelection.start / nextAudio.duration;
        return;
      }
      if (activeSelection && nextAudio.currentTime >= activeSelection.end - 0.008) {
        if (loop) {
          nextAudio.currentTime = activeSelection.start;
          progress = activeSelection.start / nextAudio.duration;
          if (nextAudio.paused) nextAudio.play().catch(() => undefined);
        } else {
          nextAudio.pause();
          nextAudio.currentTime = activeSelection.end;
          progress = activeSelection.end / nextAudio.duration;
          playing = false;
        }
        return;
      }
      progress = nextAudio.currentTime / nextAudio.duration;
    };
    const stopPlaybackFrame = () => {
      if (!playbackFrame) return;
      window.cancelAnimationFrame(playbackFrame);
      playbackFrame = 0;
    };
    const updatePlaybackFrame = () => {
      playbackFrame = 0;
      if (audio !== nextAudio || nextAudio.paused || nextAudio.ended) return;
      onTimeUpdate();
      playbackFrame = window.requestAnimationFrame(updatePlaybackFrame);
    };
    const startPlaybackFrame = () => {
      if (!playbackFrame) playbackFrame = window.requestAnimationFrame(updatePlaybackFrame);
    };
    const onLoadedMetadata = () => {
      if (
        currentSelected
        &&
        Number.isFinite(nextAudio.duration)
        && nextAudio.duration > 0
        && !usesProcessedPreview
        && currentSelected.duration !== nextAudio.duration
      ) currentSelected.duration = nextAudio.duration;
      if (!soundChanged && retainedProgress > 0 && Number.isFinite(nextAudio.duration) && nextAudio.duration > 0) {
        if (activePreviewScope && currentSelected?.duration) {
          const sourceTime = retainedProgress * currentSelected.duration;
          const ratio = (sourceTime - activePreviewScope.start) / Math.max(0.001, activePreviewScope.end - activePreviewScope.start);
          nextAudio.currentTime = Math.max(0, Math.min(nextAudio.duration, ratio * nextAudio.duration));
        } else nextAudio.currentTime = Math.max(0, Math.min(nextAudio.duration, retainedProgress * nextAudio.duration));
      }
      if (shouldResume && audio === nextAudio) {
        nextAudio.play().catch(() => {
          if (audio === nextAudio) playing = false;
          notify("error", "Audio preview could not resume after updating effects.");
        });
      }
    };
    const onPlay = () => {
      if (audio !== nextAudio) return;
      playing = true;
      startPlaybackFrame();
    };
    const onPause = () => {
      if (audio !== nextAudio) return;
      stopPlaybackFrame();
      if (!nextAudio.ended) playing = false;
    };
    const onEnded = () => {
      stopPlaybackFrame();
      const activeSelection = segmentSelection;
      if (loop) {
        const restartAt = activeSelection && !usesProcessedPreview ? activeSelection.start : 0;
        nextAudio.currentTime = restartAt;
        progress = activePreviewScope && currentSelected?.duration
          ? activePreviewScope.start / currentSelected.duration
          : restartAt / Math.max(nextAudio.duration || 0, 0.001);
        nextAudio.play().catch(() => {
          if (audio === nextAudio) playing = false;
        });
        return;
      }
      playing = false;
      progress = activePreviewScope && currentSelected?.duration ? activePreviewScope.end / currentSelected.duration : 1;
    };
    const onError = () => {
      if (audio !== nextAudio) return;
      playing = false;
      if (!nextAudio.paused || nextAudio.currentTime > 0) return;
      notify("error", "This audio format could not be previewed by CEP.");
    };
    nextAudio.addEventListener("timeupdate", onTimeUpdate);
    nextAudio.addEventListener("play", onPlay);
    nextAudio.addEventListener("pause", onPause);
    nextAudio.addEventListener("loadedmetadata", onLoadedMetadata);
    nextAudio.addEventListener("ended", onEnded);
    nextAudio.addEventListener("error", onError);
    audio = nextAudio;
    startPendingPreview();

    return () => {
      nextAudio.removeEventListener("timeupdate", onTimeUpdate);
      nextAudio.removeEventListener("play", onPlay);
      nextAudio.removeEventListener("pause", onPause);
      nextAudio.removeEventListener("loadedmetadata", onLoadedMetadata);
      nextAudio.removeEventListener("ended", onEnded);
      nextAudio.removeEventListener("error", onError);
      stopPlaybackFrame();
      if (audio === nextAudio) {
        sourceSwapWasPlaying = !nextAudio.paused && !nextAudio.ended;
        sourceSwapProgress = progress;
      }
      nextAudio.pause();
      if (audio === nextAudio) {
        audio = null;
        audioPreviewScope = null;
        audioUsesProcessedPreview = false;
      }
      nextAudio.removeAttribute("src");
      nextAudio.load();
    };
  });

  onMount(() => {
    if (!platform().capabilities.nativeStorage) return;
    let cancelled = false;
    let refreshing = false;
    const refreshPortableState = async (allowSetup = false) => {
      if (refreshing) return;
      refreshing = true;
      let info = await platform().storage.getInfo();
      if (allowSetup && !info.ok && info.error.code === "STORAGE_NOT_CONFIGURED") {
        const selected = await platform().storage.changeLocation();
        if (!selected.ok) { if (!cancelled) notify("warning", selected.error.message); refreshing = false; return; }
        if (!selected.data) { if (!cancelled) notify("info", "Portable storage setup was cancelled. Choose a folder in Settings when ready."); refreshing = false; return; }
        info = { ok: true, data: selected.data };
      }
      if (!info.ok) { if (allowSetup && !cancelled) notify("warning", info.error.message); refreshing = false; return; }
      if (cancelled) { refreshing = false; return; }
      storageInfo = info.data;
      portablePreferencesReady = false;
      await loadPortableLibraryMetadata();
      if (cancelled) { refreshing = false; return; }
      collections = loadFavoriteCollections();
      savedCloudFavorites = loadCloudFavorites();
      if (platform().capabilities.nativeLibrary) {
        const hydrated = hydrateLibraryMetadata(folders, sounds);
        folders = hydrated.folders;
        sounds = hydrated.sounds;
      }
      const stored = await platform().storage.getPreferences();
      if (cancelled) { refreshing = false; return; }
      if (stored.ok && stored.data) applyPortablePreferences(stored.data);
      portablePreferencesReady = true;
      refreshing = false;
    };
    const refreshWhenVisible = () => { if (!document.hidden) void refreshPortableState(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    void refreshPortableState(true);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  });

  onMount(() => {
    const flush = () => flushLibraryMetadata();
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      if (waveformAnalysisTimer) window.clearTimeout(waveformAnalysisTimer);
      flushLibraryMetadata();
    };
  });

  onMount(() => {
    const syncResultRowHeight = () => { resultRowHeight = resultRowHeightForViewport(compactResults); };
    window.addEventListener("resize", syncResultRowHeight);
    syncResultRowHeight();
    return () => window.removeEventListener("resize", syncResultRowHeight);
  });

  onMount(() => {
    let timer: number | null = null;
    const syncRelativeTimeClock = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (!document.hidden) {
        now = Date.now();
        timer = window.setInterval(() => { now = Date.now(); }, 60000);
      }
    };
    document.addEventListener("visibilitychange", syncRelativeTimeClock);
    syncRelativeTimeClock();
    return () => {
      document.removeEventListener("visibilitychange", syncRelativeTimeClock);
      if (timer !== null) window.clearInterval(timer);
    };
  });

  onMount(() => {
    let cancelled = false;
    checkForUpdates().then((next) => {
      if (cancelled) return;
      updateState = next;
      updateDismissed = isUpdateDismissed(next.latestVersion);
    });
    return () => { cancelled = true; };
  });

  onMount(() => {
    if (!window.cep && !platform().capabilities.nativeProjectHandoff) return;
    let cancelled = false;
    const refreshProject = async () => {
      const context = await getHostProjectContext();
      if (cancelled || !context.ok || !context.projectPath) return;
      if (activeProjectPath && activeProjectPath !== context.projectPath) {
        const resetPreparedSound = (sound: SoundFile): SoundFile => {
          if (!sound.preparedProjectPath || sound.preparedProjectPath === context.projectPath) return sound;
          return {
            ...sound,
            path: isCloudSound(sound) ? "" : sound.originalPath || sound.path,
            extension: sound.originalExtension || sound.extension,
            size: isCloudSound(sound) ? 0 : sound.size,
            modifiedAt: isCloudSound(sound) ? 0 : sound.modifiedAt,
            downloadState: isCloudSound(sound) ? "remote" : sound.downloadState,
            preparedProjectPath: undefined,
            preparedProfile: undefined,
          };
        };
        sounds = sounds.map(resetPreparedSound);
        freesoundSounds = freesoundSounds.map(resetPreparedSound);
        for (const [id, cachedSound] of freesoundSessionCache) {
          freesoundSessionCache.set(id, resetPreparedSound(cachedSound));
        }
        preparedSegmentCache.clear();
        preparedProcessingCache.clear();
        preparedSegment = null;
        cancelSegmentPreparation();
      }
      activeProjectPath = context.projectPath;
    };
    const refreshWhenVisible = () => { if (!document.hidden) refreshProject(); };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    refreshProject();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  });

  onMount(() => {
    const tooltipTarget = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(".tooltip[data-tooltip]") : null;
    let tooltipGeneration = 0;
    const hideTooltip = () => {
      tooltipGeneration += 1;
      if (tooltipTimer !== null) window.clearTimeout(tooltipTimer);
      tooltipTimer = null;
      if (tooltipHideTimer !== null) window.clearTimeout(tooltipHideTimer);
      // Focus can move while Svelte is reconciling keyed rows. Defer the state
      // update so it never occurs inside a template/derived update.
      tooltipHideTimer = window.setTimeout(() => {
        tooltipHideTimer = null;
        floatingTooltip = null;
      }, 0);
    };
    const showTooltip = (element: HTMLElement) => {
      hideTooltip();
      const generation = tooltipGeneration;
      tooltipTimer = window.setTimeout(async () => {
        const text = element.dataset.tooltip;
        if (!text || !document.documentElement.contains(element)) return;
        const rect = element.getBoundingClientRect();
        const above = Boolean(element.closest(".transport-bar")) || rect.bottom + 38 > window.innerHeight;
        const halfWidth = Math.min(96, Math.max(42, window.innerWidth / 2 - 8));
        const center = rect.left + rect.width / 2;
        floatingTooltip = { text, x: Math.max(halfWidth, Math.min(window.innerWidth - halfWidth, center)), y: above ? rect.top - 7 : rect.bottom + 7, above };
        await tick();
        if (generation !== tooltipGeneration || !floatingTooltip) return;
        const tooltip = document.querySelector<HTMLElement>(".floating-tooltip");
        if (!tooltip) return;
        const bounds = tooltip.getBoundingClientRect();
        const placeAbove = rect.bottom + 7 + bounds.height > window.innerHeight - 8;
        const x = Math.max(bounds.width / 2 + 8, Math.min(window.innerWidth - bounds.width / 2 - 8, center));
        const top = Math.max(8, Math.min(window.innerHeight - bounds.height - 8, placeAbove ? rect.top - bounds.height - 7 : rect.bottom + 7));
        floatingTooltip = { text, x, y: placeAbove ? top + bounds.height : top, above: placeAbove };
      }, 380);
    };
    const onPointerOver = (event: PointerEvent) => {
      const next = tooltipTarget(event.target);
      if (next && next !== tooltipTarget(event.relatedTarget)) showTooltip(next);
    };
    const onPointerOut = (event: PointerEvent) => {
      const current = tooltipTarget(event.target);
      if (current && current !== tooltipTarget(event.relatedTarget)) hideTooltip();
    };
    const onFocusIn = (event: FocusEvent) => { const target = tooltipTarget(event.target); if (target) showTooltip(target); };
    document.addEventListener("pointerover", onPointerOver);
    document.addEventListener("pointerout", onPointerOut);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", hideTooltip);
    window.addEventListener("resize", hideTooltip);
    document.addEventListener("scroll", hideTooltip, true);
    return () => {
      if (tooltipTimer !== null) window.clearTimeout(tooltipTimer);
      tooltipTimer = null;
      if (tooltipHideTimer !== null) window.clearTimeout(tooltipHideTimer);
      tooltipHideTimer = null;
      document.removeEventListener("pointerover", onPointerOver);
      document.removeEventListener("pointerout", onPointerOut);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", hideTooltip);
      window.removeEventListener("resize", hideTooltip);
      document.removeEventListener("scroll", hideTooltip, true);
    };
  });

  onMount(() => {
    // CEP forwards unclaimed keys to Premiere/After Effects. Claim Space only;
    // text fields still opt out below so typing remains native.
    try {
      if ("cep" in window) {
        platform().runtime.registerKeyEventsInterest([{
          keyCode: 32,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
        }]);
      }
    } catch (_error) {
      // Browser preview and older CEP shells keep the DOM fallback below.
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      } else if (event.key === "Escape") {
        if (document.querySelector(".toolbar-popover-panel")) return;
        if (effectsOpen) {
          effectsOpen = false;
          window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".effects-button")?.focus());
          return;
        }
        if (afterEffectsDragSession) afterEffectsDragSession.cancelled = true;
        if (preparationDragSession) preparationDragSession.cancelled = true;
        if (segmentDragPreparation) segmentDragCancelled = true;
        settingsOpen = false;
        sidebarOpen = false;
        compactPreviewOpen = false;
      } else if (event.code === "Space" && !editing) {
        if (target?.closest("button, [role='slider']")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.repeat) return;
        togglePlay();
      }
    };
    const handOffPreviewToHost = () => {
      const audioIsPlaying = Boolean(audio && !audio.paused);
      if (!playing && !audioIsPlaying) return;
      pendingPlayId = null;
      stopPlayback();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", handOffPreviewToHost);
    document.addEventListener("dragenter", markDragInsidePanel);
    document.addEventListener("dragleave", markDragOutsidePanel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("blur", handOffPreviewToHost);
      document.removeEventListener("dragenter", markDragInsidePanel);
      document.removeEventListener("dragleave", markDragOutsidePanel);
    };
  });

  onMount(() => {
    if (platform().capabilities.nativeLibrary) {
      let cancelled = false;
      let refreshing = false;
      const refresh = () => {
        if (refreshing) return;
        refreshing = true;
        platform().library.getSnapshot().then((result) => {
          refreshing = false;
          if (cancelled) return;
          if (!result.ok) {
            notify("error", result.error.message);
            return;
          }
          applyNativeLibrarySnapshot(result.data);
        });
      };
      const refreshWhenVisible = () => { if (!document.hidden) refresh(); };
      window.addEventListener("focus", refreshWhenVisible);
      document.addEventListener("visibilitychange", refreshWhenVisible);
      refresh();
      return () => {
        cancelled = true;
        window.removeEventListener("focus", refreshWhenVisible);
        document.removeEventListener("visibilitychange", refreshWhenVisible);
      };
    }
    if (!window.cep) return;
    let cancelled = false;
    const restore = async () => {
      if (libraryRestoreInProgress) return;
      const storedPaths = loadLibraryPaths();
      const signature = JSON.stringify(storedPaths);
      if (signature === persistedLibrarySignature) return;
      const isCrossHostRefresh = librarySyncInitialized;
      persistedLibrarySignature = signature;
      librarySyncInitialized = true;
      libraryRestoreInProgress = true;

      if (!storedPaths.length) {
        if (isCrossHostRefresh && !cancelled) {
          folders = [];
          sounds = [];
          selectedId = "";
          tabs = createLibraryTabs();
          activeTabId = "search-library";
          notify("info", "Shared library cleared. Add a folder when you are ready.");
        }
        libraryRestoreInProgress = false;
        return;
      }

      isIndexing = true;
      indexProgress = { files: 0, folders: 0, currentPath: "" };
      const nextFolders: LibraryFolder[] = [];
      const nextSounds: SoundFile[] = [];
      let completedFiles = 0;
      let completedFolders = 0;
      let restoreSkippedPaths = 0;
      let failedStoredPaths = 0;
      let firstRestoreError = "";
      for (let index = 0; index < storedPaths.length; index += 1) {
        try {
          const result = await scanFolder(storedPaths[index], nextAccent(index), (nextProgress) => {
            indexProgress = { files: completedFiles + nextProgress.files, folders: completedFolders + nextProgress.folders, currentPath: nextProgress.currentPath };
          });
          nextFolders.push(result.folder);
          nextSounds.push(...result.sounds);
          completedFiles += result.sounds.length;
          completedFolders += countTreeNodes(result.folder.tree);
          restoreSkippedPaths += result.diagnostics.unreadableDirectories + result.diagnostics.unreadableEntries;
        } catch (error) {
          // Unavailable folders are skipped without corrupting the shared path list.
          failedStoredPaths += 1;
          if (!firstRestoreError) firstRestoreError = error instanceof Error ? error.message : "A saved library could not be opened.";
        }
      }
      if (!cancelled && nextFolders.length) {
        const hydrated = hydrateLibraryMetadata(nextFolders, nextSounds);
        folders = hydrated.folders;
        sounds = hydrated.sounds;
        selectedId = "";
        enqueueWaveformAnalysis(hydrated.sounds);
        tabs = createLibraryTabs();
        activeTabId = "search-library";
        if (failedStoredPaths || restoreSkippedPaths) {
          notify(
            "warning",
            `Library loaded - ${nextSounds.length} sounds - ${failedStoredPaths} libraries unavailable - ${restoreSkippedPaths} paths skipped`,
          );
        } else if (isCrossHostRefresh) notify("success", `Library synced · ${nextSounds.length} sounds`);
      } else if (!cancelled) {
        notify("warning", firstRestoreError || "Saved library paths are currently unavailable on this computer.");
      }
      if (!cancelled) isIndexing = false;
      libraryRestoreInProgress = false;
    };
    const syncWhenVisible = () => { if (!document.hidden) restore(); };
    window.addEventListener("focus", syncWhenVisible);
    document.addEventListener("visibilitychange", syncWhenVisible);
    restore();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", syncWhenVisible);
      document.removeEventListener("visibilitychange", syncWhenVisible);
    };
  });

  const seek = (nextProgress: number) => {
    const sourceDuration = selected?.duration || 0;
    const minimum = segmentSelection && sourceDuration > 0 ? segmentSelection.start / sourceDuration : 0;
    const maximum = segmentSelection && sourceDuration > 0 ? segmentSelection.end / sourceDuration : 1;
    progress = Math.max(minimum, Math.min(maximum, nextProgress));
    if (audio?.duration) {
      if (audioUsesProcessedPreview && audioPreviewScope && sourceDuration > 0) {
        const sourceTime = progress * sourceDuration;
        const ratio = (sourceTime - audioPreviewScope.start) / Math.max(0.001, audioPreviewScope.end - audioPreviewScope.start);
        audio.currentTime = Math.max(0, Math.min(audio.duration, ratio * audio.duration));
      } else audio.currentTime = progress * audio.duration;
    }
  };

  const segmentRequestKey = (sound: SoundFile, selection: AudioSegmentSelection) => [
    sound.id,
    sound.path,
    sound.size,
    sound.modifiedAt,
    `${conversionPolicy}:${audioNormalizationKey(normalization, normalizationTargetDb)}`,
    audioProcessingKey(processing),
    Math.round(selection.start * 1000),
    Math.round(selection.end * 1000),
  ].join("|");

  const segmentKey = (sound: SoundFile, selection: AudioSegmentSelection, projectPath: string) =>
    `${segmentRequestKey(sound, selection)}|${projectPath}`;

  const prepareSelectedSegment = async (selection: AudioSegmentSelection, announceErrors = true) => {
    const sound = selected;
    if (!sound) return null;
    if ((!window.cep && !platform().capabilities.nativeAudioPreparation) || host === "browser") return null;
    const requestKey = segmentRequestKey(sound, selection);
    if (activeSegmentPreparation && activeSegmentPreparationKey === requestKey) {
      try {
        return await activeSegmentPreparation;
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === "AbortError";
        if (!aborted && announceErrors && selectedId === sound.id) {
          notify("error", error instanceof Error ? error.message : "The selected audio segment could not be prepared.");
        }
        return null;
      }
    }

    cancelSegmentPreparation();
    const controller = new AbortController();
    segmentPreparationController = controller;
    activeSegmentPreparationKey = requestKey;
    const generation = ++segmentPreparationGeneration;
    segmentPreparing = true;
    preparedSegment = null;

    const task = (async () => {
      const project = await getHostProjectContext();
      if (!project.ok || !project.projectPath) throw new Error(project.message);
      if (controller.signal.aborted) throw new DOMException("Audio preparation was cancelled.", "AbortError");
      const key = segmentKey(sound, selection, project.projectPath);
      const cached = preparedSegmentCache.get(key);
      if (cached) return cached;
      const prepared = await prepareAudioSegmentForHost(sound, selection, {
        host,
        project,
        conversionPolicy,
        normalization,
        normalizationTargetDb,
        processing,
        signal: controller.signal,
      });
      preparedSegmentCache.set(key, prepared.sound);
      while (preparedSegmentCache.size > 16) {
        const oldestKey = preparedSegmentCache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        preparedSegmentCache.delete(oldestKey);
      }
      return prepared.sound;
    })();
    activeSegmentPreparation = task;

    try {
      const prepared = await task;
      if (generation === segmentPreparationGeneration && selectedId === sound.id) preparedSegment = prepared;
      return prepared;
    } catch (error) {
      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
      if (!aborted && announceErrors && generation === segmentPreparationGeneration) {
        notify("error", error instanceof Error ? error.message : "The selected audio segment could not be prepared.");
      }
      return null;
    } finally {
      if (generation === segmentPreparationGeneration) {
        segmentPreparing = false;
        segmentPreparationController = null;
        activeSegmentPreparationKey = "";
        activeSegmentPreparation = null;
      }
    }
  };

  const updateSegmentSelection = (next: AudioSegmentSelection | null, commit: boolean) => {
    cancelSegmentPreparation();
    segmentSelection = next;
    preparedSegment = null;
    if (!next) return;
    if (selected?.duration) seek(next.start / selected.duration);
    if (commit && (window.cep || platform().capabilities.nativeAudioPreparation) && host !== "browser") prepareSelectedSegment(next, false);
  };

  const selectSound = (id: string) => {
    stopHover();
    if (autoPreview && id !== selectedId) pendingPlayId = id;
    selectedId = id;
    compactPreviewOpen = true;
  };
  const closePreview = () => {
    stopPlayback();
    selectedId = "";
    compactPreviewOpen = false;
    effectsOpen = false;
  };
  const toggleSidebarPin = () => {
    sidebarPinned = !sidebarPinned;
    if (sidebarPinned) sidebarOpen = true;
    else if (libraryWidth < LIBRARY_MIN_WIDTH) setLibraryWidth(LIBRARY_MIN_WIDTH, true);
    try { localStorage.setItem(SIDEBAR_PIN_STORAGE_KEY, String(sidebarPinned)); } catch (_) { /* Storage may be unavailable in CEP. */ }
  };

  const moveSelection = (direction: number) => {
    if (!visibleSounds.length) return;
    const currentIndex = visibleSounds.findIndex((sound) => sound.id === selectedId);
    const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + visibleSounds.length) % visibleSounds.length;
    selectedId = visibleSounds[nextIndex].id;
  };

  const updateSoundRecord = (nextSound: SoundFile) => {
    if (isCloudSound(nextSound)) {
      freesoundSessionCache.set(nextSound.id, nextSound);
      freesoundSounds = freesoundSounds.map((sound) => sound.id === nextSound.id ? nextSound : sound);
      savedCloudFavorites = savedCloudFavorites.map(sound => sound.id === nextSound.id ? nextSound : sound);
    } else {
      sounds = sounds.map((sound) => sound.id === nextSound.id ? nextSound : sound);
    }
  };

  const applyNativeLibrarySnapshot = (snapshot: PlatformLibrarySnapshot) => {
    const hydrated = hydrateLibraryMetadata(snapshot.folders, snapshot.sounds);
    folders = hydrated.folders;
    sounds = hydrated.sounds;
    if (selectedId && !sounds.some((sound) => sound.id === selectedId)) selectedId = "";
    if (!folders.length) {
      tabs = createLibraryTabs();
      activeTabId = "search-library";
    }
  };

  const toggleFavorite = (sound: SoundFile) => {
    stopHover();
    favoriteEditing = sound;
    if (audio) audio.pause();
  };
  const saveFavorite = (sound: SoundFile, destination: string, favorite: boolean) => {
    const current = sounds.find(item => item.id === sound.id) || freesoundSounds.find(item => item.id === sound.id) || sound;
    const next = { ...current, favorite, favoriteCollection: destination };
    updateSoundRecord(next);
    if (platform().capabilities.nativeLibrary && !isCloudSound(next)) {
      void platform().library.setSoundFavorite(next.id, favorite).then((result) => {
        if (!result.ok) notify("error", result.error.message);
      });
    }
    saveSoundMetadata(next, { favorite, favoriteCollection: destination });
    if (isCloudSound(next)) savedCloudFavorites = [...savedCloudFavorites.filter(item => item.id !== next.id), ...(favorite ? [next] : [])];
    favoriteEditing = null;
  };
  const createCollection = (name: string, parentId: string) => {
    const clean = name.trim().slice(0, 60);
    if (!clean || /[\/\\]/.test(clean)) { notify("warning", "Use a folder name without slashes."); return ""; }
    const existing = collections.find(item => item.parentId === parentId && item.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing.id;
    const id = `collection-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    collections = [...collections, { id, name: clean, parentId }];
    saveFavoriteCollections(collections);
    return id;
  };

  const updateSoundLabel = (sound: SoundFile, color?: LabelColor) => {
    const next = { ...sound, labelColor: color };
    updateSoundRecord(next);
    if (platform().capabilities.nativeLibrary && !isCloudSound(next)) {
      void platform().library.setSoundLabel(next.id, color).then((result) => {
        if (!result.ok) notify("error", result.error.message);
      });
    }
    saveSoundMetadata(next, color ? { labelColor: color } : { clearLabel: true });
  };

  const updateFolderNode = (nodeId: string, updater: (node: LibraryFolder["tree"]) => LibraryFolder["tree"]) => {
    const updateTree = (node: LibraryFolder["tree"]): LibraryFolder["tree"] => node.id === nodeId
      ? updater(node)
      : { ...node, children: node.children.map(updateTree) };
    folders = folders.map((folder) => ({ ...folder, tree: updateTree(folder.tree) }));
  };

  const updateFolderLabel = (node: LibraryFolder["tree"], color?: LabelColor) => {
    updateFolderNode(node.id, (current) => ({ ...current, labelColor: color }));
    if (platform().capabilities.nativeLibrary) {
      void platform().library.setFolderLabel(node.id, color).then((result) => {
        if (!result.ok) notify("error", result.error.message);
      });
    }
    saveFolderMetadata(node.path, color ? { labelColor: color } : { clearLabel: true });
  };

  const toggleFolderPinned = (node: LibraryFolder["tree"]) => {
    const pinned = !node.pinned;
    updateFolderNode(node.id, (current) => ({ ...current, pinned }));
    if (platform().capabilities.nativeLibrary) {
      void platform().library.setFolderPinned(node.id, pinned).then((result) => {
        if (!result.ok) notify("error", result.error.message);
      });
    }
    saveFolderMetadata(node.path, { pinned });
    notify("info", pinned ? `${node.name} pinned to the top of Library.` : `${node.name} unpinned.`);
  };

  const updatePreparationStatus = (
    sound: SoundFile,
    stage: AudioPreparationStatus["stage"],
    message: string,
    nextProgress?: number,
  ) => {
    soundPreparation[sound.id] = {
      stage,
      message,
      progress: Number.isFinite(nextProgress) ? Math.max(0, Math.min(1, Number(nextProgress))) : undefined,
    };
  };

  const clearPreparationStatus = (soundId: string) => {
    delete soundPreparation[soundId];
  };

  const processingCacheKey = (sound: SoundFile, requestedProcessing: AudioProcessingSettings, projectPath = activeProjectPath) => [
    sound.id,
    sound.path,
    sound.size,
    sound.modifiedAt,
    `${conversionPolicy}:${audioNormalizationKey(normalization, normalizationTargetDb)}:${audioProcessingKey(requestedProcessing)}`,
    projectPath,
  ].join("|");

  const prepareSound = async (sound: SoundFile, useDefaultProcessing = false) => {
    const requestedConversionPolicy = conversionPolicy;
    const requestedNormalization = normalization;
    const requestedNormalizationTargetDb = normalizationTargetDb;
    const requestedProcessing = !useDefaultProcessing && (sound.id === selectedId || sound.id.includes(":segment:")) ? { ...processing } : { ...DEFAULT_AUDIO_PROCESSING };
    const requestKey = processingCacheKey(sound, requestedProcessing);
    const cached = getCachedProcessing(requestKey);
    if (cached) return cached;
    const existing = preparingSounds.get(requestKey);
    if (existing) return existing;
    const task = (async () => {
      const profile = `${requestedConversionPolicy}:${audioNormalizationKey(requestedNormalization, requestedNormalizationTargetDb)}:${audioProcessingKey(requestedProcessing)}`;
      let project = null as Awaited<ReturnType<typeof getHostProjectContext>> | null;
      if (sound.path && sound.preparedProfile === profile && sound.preparedProjectPath) {
        project = await getHostProjectContext();
        if (project.ok && project.projectPath === sound.preparedProjectPath) return sound;
      }
      const needsPreparation = (host === "resolve" && sound.extension.toLowerCase() !== "wav")
        || requiresProjectAudioPreparation(sound, requestedConversionPolicy, requestedNormalization, requestedProcessing, requestedNormalizationTargetDb);
      if (!needsPreparation && !sound.originalPath) return sound;
      updatePreparationStatus(
        sound,
        isCloudSound(sound) && !sound.path ? "downloading" : "converting",
        isCloudSound(sound) && !sound.path ? `Preparing ${sound.name}…` : `Preparing ${sound.name} for ${hostLabel(host)}…`,
      );
      updateSoundRecord({ ...sound, downloadState: isCloudSound(sound) ? "downloading" : sound.downloadState });
      try {
        if (!project) project = await getHostProjectContext();
        if (!project.ok) throw new Error(project.message);
        const prepared = await prepareAudioForHost(sound, {
          host,
          project,
          conversionPolicy: requestedConversionPolicy,
          normalization: requestedNormalization,
          normalizationTargetDb: requestedNormalizationTargetDb,
          processing: requestedProcessing,
          onProgress: (stage, message, nextProgress) => updatePreparationStatus(sound, stage, message, nextProgress),
        });
        const current = sounds.find((item) => item.id === sound.id) || freesoundSounds.find((item) => item.id === sound.id);
        const nextSound = current ? { ...prepared.sound, favorite: current.favorite, labelColor: current.labelColor } : prepared.sound;
        if (!hasAudioProcessing(requestedProcessing)) updateSoundRecord(nextSound);
        else {
          cachePreparedProcessing(requestKey, nextSound);
          cachePreparedProcessing(processingCacheKey(sound, requestedProcessing, prepared.sound.preparedProjectPath || activeProjectPath), nextSound);
        }
        clearPreparationStatus(sound.id);
        return nextSound;
      } catch (error) {
        clearPreparationStatus(sound.id);
        if (isCloudSound(sound)) {
          const current = freesoundSounds.find((item) => item.id === sound.id) || sound;
          updateSoundRecord({ ...current, downloadState: "error" });
        }
        throw error;
      }
    })();
    preparingSounds.set(requestKey, task);
    try {
      return await task;
    } finally {
      if (preparingSounds.get(requestKey) === task) preparingSounds.delete(requestKey);
    }
  };

  // Prepare selected local audio after controls settle, before the drag gesture.
  // Cloud downloads still start only on an explicit handoff.
  $effect(() => {
    const current = selected;
    if (host !== "resolve" || !current?.path || isCloudSound(current)) return;
    if (current.extension.toLowerCase() === "wav" && !requiresProjectAudioPreparation(current, conversionPolicy, normalization, processing, normalizationTargetDb)) return;
    const timer = window.setTimeout(() => { void prepareSound(current).catch(() => undefined); }, 250);
    return () => window.clearTimeout(timer);
  });

  const prepareAssistantSound = async (sound: SoundFile, gainDb?: number) => {
    if (host !== "resolve") return prepareSound(sound, true);
    const project = await getHostProjectContext();
    if (!project.ok) throw new Error(project.message);
    const prepared = await prepareAudioForHost(sound, {
      host, project, conversionPolicy: "always", normalization, normalizationTargetDb,
      processing: normalizeAudioProcessing({ ...DEFAULT_AUDIO_PROCESSING, gainDb: gainDb ?? 0 }),
    });
    return prepared.sound;
  };

  const loadMoreFreesound = async () => {
    const query = activeTab?.query.trim() || "";
    if (!cloudSourceActive || !freesoundHasNext || freesoundStatus === "loading" || query.length < 2) return;
    freesoundStatus = "loading";
    freesoundError = "";
    const generation = ++freesoundSearchGeneration;
    const controller = new AbortController();
    freesoundSearchController?.abort();
    freesoundSearchController = controller;
    try {
      const page = await searchSoundSources(query, freesoundApiKey, freesoundLicenseFilter, freesoundPage + 1, cloudLibraryEnabled, freesoundLibraryEnabled && freesoundSourceEnabled, controller.signal);
      if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
      const existing = new Set(freesoundSounds.map((sound) => sound.id));
      freesoundSounds = [
        ...freesoundSounds,
        ...hydrateFreesoundResults(page.sounds.filter((sound) => !existing.has(sound.id))),
      ];
      freesoundPage = page.page;
      freesoundHasNext = page.hasNext;
      freesoundStatus = "ready";
    } catch (error) {
      if (controller.signal.aborted || generation !== freesoundSearchGeneration) return;
      freesoundStatus = "error";
      freesoundError = error instanceof Error ? error.message : "More Freesound results could not be loaded.";
    }
  };

  const addFolder = async () => {
    if (platform().capabilities.nativeLibrary) {
      isIndexing = true;
      try {
        const result = await platform().library.addFolder();
        if (!result.ok) throw new Error(result.error.message);
        if (!result.data) { notify("info", "No folder was selected."); return; }
        applyNativeLibrarySnapshot(result.data);
        notify("success", `Library updated - ${result.data.sounds.length} sounds indexed.`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "The folder could not be indexed.");
      } finally {
        isIndexing = false;
      }
      return;
    }
    notify("info", "Choose a folder. Windows hides files while selecting folders.");
    await waitForPanelPaint();
    let chosen: string | null = null;
    try {
      chosen = chooseLibraryFolder();
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The folder picker could not open.");
      return;
    }
    if (!chosen) {
      notify(window.cep ? "info" : "warning", window.cep ? "No folder was selected." : "Folder picking is available inside the installed CEP panel.");
      return;
    }
    if (folders.some((folder) => sameNativePath(folder.path, chosen))) {
      notify("warning", "That folder is already indexed.");
      return;
    }
    isIndexing = true;
    indexProgress = { files: 0, folders: 1, currentPath: chosen };
    notify("info", `Indexing ${folderNameFromPath(chosen)}…`);
    await waitForPanelPaint();
    try {
      const result = await scanFolder(chosen, nextAccent(folders.length), (next) => { indexProgress = next; });
      const nextFolders = [...folders, result.folder];
      const nextSounds = [...sounds, ...result.sounds];
      const hydrated = hydrateLibraryMetadata(nextFolders, nextSounds);
      folders = hydrated.folders;
      sounds = hydrated.sounds;
      persistLibraryFolders(hydrated.folders);
      selectedId = "";
      enqueueWaveformAnalysis(hydrated.sounds.filter((sound) => sound.folderId === result.folder.id));
      if (nextFolders.length === 1) {
        tabs = createLibraryTabs();
        activeTabId = "search-library";
      }
      setActiveTabFolder(result.folder.id);
      indexProgress = { files: result.sounds.length, folders: countTreeNodes(result.folder.tree), currentPath: result.folder.path };
      const skippedPaths = result.diagnostics.unreadableDirectories + result.diagnostics.unreadableEntries;
      const seenExtensions = result.diagnostics.extensionsSeen.length
        ? ` - extensions: ${result.diagnostics.extensionsSeen.join(", ")}`
        : "";
      const scanMessage = !result.sounds.length
        ? `${result.folder.name}: 0 supported sounds - scanned ${result.diagnostics.filesSeen} files via ${result.diagnostics.scanner.toUpperCase()}${seenExtensions}`
        : skippedPaths
          ? `${result.folder.name} indexed - ${result.sounds.length} sounds - ${skippedPaths} unreadable paths skipped`
          : `${result.folder.name} indexed - ${result.sounds.length} sounds - ${countTreeNodes(result.folder.tree)} folders`;
      notify(result.sounds.length && !skippedPaths ? "success" : "warning", scanMessage);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The folder could not be indexed.");
    } finally {
      isIndexing = false;
    }
  };

  const rescanAll = async () => {
    if (!folders.length) { notify("info", "Add a sound folder to start indexing."); return; }
    if (platform().capabilities.nativeLibrary) {
      isIndexing = true;
      try {
        const result = await platform().library.rescan();
        if (!result.ok) throw new Error(result.error.message);
        applyNativeLibrarySnapshot(result.data);
        notify("success", `Library refreshed - ${result.data.sounds.length} sounds.`);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "The sound libraries could not be refreshed.");
      } finally {
        isIndexing = false;
      }
      return;
    }
    isIndexing = true;
    indexProgress = { files: 0, folders: 0, currentPath: "" };
    notify("info", "Refreshing sound libraries…");
    await waitForPanelPaint();
    const nextFolders: LibraryFolder[] = [];
    const nextSounds: SoundFile[] = [];
    let completedFiles = 0;
    let completedFolders = 0;
    let skippedPaths = 0;
    let failedLibraries = 0;
    try {
      for (const folder of folders) {
        try {
          const result = await scanFolder(folder.path, folder.accent, (next) => {
            indexProgress = { files: completedFiles + next.files, folders: completedFolders + next.folders, currentPath: next.currentPath };
          });
          nextFolders.push(result.folder);
          nextSounds.push(...result.sounds);
          completedFiles += result.sounds.length;
          completedFolders += countTreeNodes(result.folder.tree);
          skippedPaths += result.diagnostics.unreadableDirectories + result.diagnostics.unreadableEntries;
        } catch (error) {
          // Keep the last valid index and persisted folder path on transient Windows or drive errors.
          const existingSounds = sounds.filter((sound) => sound.folderId === folder.id);
          nextFolders.push(folder);
          nextSounds.push(...existingSounds);
          completedFiles += existingSounds.length;
          completedFolders += countTreeNodes(folder.tree);
          failedLibraries += 1;
          notify("error", error instanceof Error ? error.message : `${folder.name} could not be refreshed.`);
        }
      }
      const hydrated = hydrateLibraryMetadata(nextFolders, nextSounds);
      folders = hydrated.folders;
      sounds = hydrated.sounds;
      selectedId = "";
      persistLibraryFolders(hydrated.folders);
      enqueueWaveformAnalysis(hydrated.sounds);
      const refreshHasWarnings = failedLibraries > 0 || skippedPaths > 0;
      const refreshDetail = refreshHasWarnings
        ? ` - ${failedLibraries} libraries unavailable - ${skippedPaths} paths skipped`
        : "";
      notify(refreshHasWarnings ? "warning" : "success", `Library refreshed - ${nextSounds.length} sounds - ${completedFolders} folders${refreshDetail}`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The sound libraries could not be refreshed.");
    } finally {
      isIndexing = false;
      indexProgress = { files: completedFiles, folders: completedFolders, currentPath: "" };
    }
  };

  const insertPreparedInHost = async (prepared: SoundFile) => {
    const context = await getHostProjectContext();
    if (!context.ok || !context.projectPath) throw new Error(context.message);
    if (prepared.preparedProjectPath && prepared.preparedProjectPath !== context.projectPath) {
      throw new Error(`The active ${hostLabel(host)} project changed. Prepare the sound again for the current project.`);
    }
    const result = await insertAudioInHost({ path: prepared.path, name: prepared.name, targetAudioTrack: -1, insertionTarget, channelMode: prepared.channels === 1 ? "mono" : "stereo", projectPath: context.projectPath });
    notify(result.ok ? "success" : "error", result.message);
  };

  const insertPreparedFromDrag = async (prepared: SoundFile) => {
    if (insertBusy) return;
    insertBusy = true;
    try {
      await insertPreparedInHost(prepared);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The prepared sound could not be inserted.");
    } finally {
      insertBusy = false;
    }
  };

  const insertSelected = async (soundOverride?: SoundFile | null) => {
    const sound = soundOverride || selected;
    if (!sound || insertBusy) return;
    insertBusy = true;
    try {
      if (!soundOverride && segmentSelection && host === "browser") {
        notify("success", `Segment insert simulated (${(segmentSelection.end - segmentSelection.start).toFixed(2)} seconds).`);
        return;
      }
      const prepared = !soundOverride && segmentSelection
        ? await prepareSelectedSegment(segmentSelection)
        : await prepareSound(sound);
      if (!prepared) throw new Error("The selected audio segment could not be prepared.");
      await insertPreparedInHost(prepared);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "The sound could not be prepared for Adobe.");
    } finally {
      insertBusy = false;
    }
  };

  const removeSelectedFromIndex = () => {
    const removed = selected;
    if (!removed) return;
    const nextSelectedId = visibleSounds.find((sound) => sound.id !== removed.id)?.id || "";
    if (isCloudSound(removed)) freesoundSounds = freesoundSounds.filter((sound) => sound.id !== removed.id);
    else sounds = sounds.filter((sound) => sound.id !== removed.id);
    selectedId = nextSelectedId;
    notify("info", isCloudSound(removed) ? "Removed from these cloud results. Downloaded project files were kept." : "Removed from the search index. The source file was kept.");
  };

  const deleteSettingsFolder = async () => {
    if (!settingsFolder) return;
    if (platform().capabilities.nativeLibrary) {
      const deletedName = settingsFolder.name;
      const result = await platform().library.removeFolder(settingsFolder.id);
      if (!result.ok) { notify("error", result.error.message); return; }
      applyNativeLibrarySnapshot(result.data);
      settingsOpen = false;
      notify("info", `${deletedName} removed from SoundDesigner. Files were kept.`);
      return;
    }
    const deletedName = settingsFolder.name;
    const deletedTree = settingsFolder.tree;
    const deletedFolderId = settingsFolder.id;
    const deletedFolderScopes = new Set<string>();
    collectTreeIds(deletedTree, deletedFolderScopes);
    deletedFolderScopes.add(deletedFolderId);
    const nextFolders = folders.filter((folder) => folder.id !== settingsFolder?.id);
    const nextSounds = sounds.filter((sound) => sound.folderId !== settingsFolder?.id);
    folders = nextFolders;
    sounds = nextSounds;
    persistLibraryFolders(nextFolders);
    selectedId = nextSounds[0]?.id || "";
    if (!nextFolders.length) {
      tabs = createLibraryTabs();
      activeTabId = "search-library";
    } else tabs = tabs.map((tab) => {
      if (!deletedFolderScopes.has(tab.folderId)) return tab;
      const resetTab = { ...tab, folderId: "all" };
      return { ...resetTab, label: searchTabLabel(resetTab, folderNameForId) };
    });
    settingsOpen = false;
    notify("info", `${deletedName} removed from SoundDesigner. Files were kept.`);
  };

  const updateSearchQuery = (query: string) => {
    tabs = updateSearchTabQuery(tabs, activeTabId, query, folderNameForId);
  };
  const addSearchTab = () => {
    const id = `search-${Date.now()}`;
    tabs = [...tabs, createSearchTab(id, selectedFolder, folderNameForId)];
    activeTabId = id;
  };
  const closeSearchTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const nextTabs = tabs.filter((tab) => tab.id !== id);
    tabs = nextTabs;
    if (id === activeTabId) activeTabId = nextTabs[Math.max(0, index - 1)].id;
  };

  const prepareAfterEffectsDrag = (sound: SoundFile) => {
    if (host !== "aftereffects" || !sound.path) return;
    const request = { path: sound.path, name: sound.name, targetAudioTrack: -1, projectPath: sound.preparedProjectPath || activeProjectPath };
    afterEffectsDragSession = {
      id: ++afterEffectsDragSessionId,
      soundId: sound.id,
      baseline: getAfterEffectsAudioDragState(request),
      leftPanel: false,
      cancelled: false,
    };
  };

  const droppedOutsidePanel = (event: DragEvent, leftPanel = false) => leftPanel
    || event.clientX <= 0
    || event.clientY <= 0
    || event.clientX >= window.innerWidth
    || event.clientY >= window.innerHeight;

  const startPreparationDrag = (sound: SoundFile) => {
    if (preparationDragSession?.soundId === sound.id && !preparationDragSession.cancelled) return preparationDragSession;
    if (preparationDragSession) preparationDragSession.cancelled = true;
    const promise = prepareSound(sound);
    // Pointer prewarming can finish without a drag. Attach a rejection handler
    // now so a cancelled gesture never creates an unhandled promise.
    promise.catch(() => undefined);
    preparationDragSession = {
      id: ++preparationDragSessionId,
      soundId: sound.id,
      promise,
      leftPanel: false,
      cancelled: false,
      announced: false,
    };
    return preparationDragSession;
  };

  const prepareSoundForDrag = (sound: SoundFile) => {
    const requestedProcessing = sound.id === selectedId || sound.id.includes(":segment:") ? processing : DEFAULT_AUDIO_PROCESSING;
    const cached = getCachedProcessing(processingCacheKey(sound, requestedProcessing));
    if (cached) {
      if (host === "aftereffects") prepareAfterEffectsDrag(cached);
      return;
    }
    if ((host === "resolve" && sound.extension.toLowerCase() !== "wav") || requiresProjectAudioPreparation(sound, conversionPolicy, normalization, requestedProcessing, normalizationTargetDb)) {
      startPreparationDrag(sound);
      return;
    }
    if (host === "aftereffects") prepareAfterEffectsDrag(sound);
  };

  const dragSound = (sound: SoundFile, event: DragEvent) => {
    const requestedProcessing = sound.id === selectedId || sound.id.includes(":segment:") ? processing : DEFAULT_AUDIO_PROCESSING;
    const cached = getCachedProcessing(processingCacheKey(sound, requestedProcessing));
    if (cached) {
      dragSound(cached, event);
      return;
    }
    if ((host === "resolve" && sound.extension.toLowerCase() !== "wav") || requiresProjectAudioPreparation(sound, conversionPolicy, normalization, requestedProcessing, normalizationTargetDb)) {
      const session = startPreparationDrag(sound);
      session.leftPanel = false;
      session.cancelled = false;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `${sound.name} · preparing for ${hostLabel(host)}`);
      }
      if (!session.announced) {
        session.announced = true;
        notify("info", `Preparing ${sound.name} · release over ${hostLabel(host)} to insert automatically.`);
      }
      return;
    }
    if (preparationDragSession?.soundId === sound.id) {
      preparationDragSession.cancelled = true;
      preparationDragSession = null;
    }
    if (!sound.path || !event.dataTransfer) { event.preventDefault(); return; }
    if (host === "resolve") {
      event.preventDefault();
      void platform().audio.startDrag({ path: sound.path, sourceId: sound.sourceId || sound.id, displayName: sound.name, projectPath: sound.preparedProjectPath || activeProjectPath }).then((result) => {
        if (!result.ok) notify("error", result.error.message);
      });
      return;
    }
    if (host === "aftereffects" && afterEffectsDragSession?.soundId !== sound.id) prepareAfterEffectsDrag(sound);
    if (afterEffectsDragSession?.soundId === sound.id) {
      afterEffectsDragSession.leftPanel = false;
      afterEffectsDragSession.cancelled = false;
    }
    const uri = fileUrl(sound.path);
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("com.adobe.cep.dnd.file.0", sound.path);
    event.dataTransfer.setData("text/uri-list", uri);
    event.dataTransfer.setData("text/plain", sound.path);
    event.dataTransfer.setData("DownloadURL", `audio/${sound.extension}:${sound.name}.${sound.extension}:${uri}`);
  };

  const organizeAudioAfterNativeDrop = async (sound: SoundFile) => {
    const request = { path: sound.path, name: sound.name, targetAudioTrack: -1, projectPath: sound.preparedProjectPath || activeProjectPath };
    const retryDelays = [80, 160, 280, 450, 700];
    for (const delay of retryDelays) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
      const result = await organizeAudioInHost(request);
      if (result.ok) return;
    }
    notify("warning", `${sound.name} was added, but its project item could not be moved into SoundDesigner.`);
  };

  const finishAfterEffectsDrag = async (sound: SoundFile, event: DragEvent) => {
    if (host !== "aftereffects") return;
    const session = afterEffectsDragSession;
    afterEffectsDragSession = null;
    if (!session || session.soundId !== sound.id || session.cancelled) return;

    if (!droppedOutsidePanel(event, session.leftPanel)) return;

    const nativeDropAccepted = event.dataTransfer
      && event.dataTransfer.dropEffect
      && event.dataTransfer.dropEffect !== "none";
    if (nativeDropAccepted) {
      await organizeAudioAfterNativeDrop(sound);
      return;
    }

    const baseline = await session.baseline;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
    if (session.id !== afterEffectsDragSessionId) return;
    const request = { path: sound.path, name: sound.name, targetAudioTrack: -1, projectPath: sound.preparedProjectPath || activeProjectPath };
    const current = await getAfterEffectsAudioDragState(request);
    const nativeLayerWasAdded = baseline.ok
      && current.ok
      && baseline.compositionId === current.compositionId
      && current.layerCount > baseline.layerCount;
    if (nativeLayerWasAdded) await organizeAudioAfterNativeDrop(sound);
    else await insertSelected(sound);
  };

  const finishSoundDrag = async (sound: SoundFile, event: DragEvent) => {
    const preparationSession = preparationDragSession;
    if (preparationSession?.soundId === sound.id) {
      preparationDragSession = null;
      if (preparationSession.cancelled || !droppedOutsidePanel(event, preparationSession.leftPanel)) return;
      try {
        const prepared = await preparationSession.promise;
        if (preparationSession.cancelled || preparationSession.id !== preparationDragSessionId) return;
        await insertPreparedFromDrag(prepared);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "The sound could not be prepared and inserted.");
      }
      return;
    }
    if (host === "aftereffects") {
      await finishAfterEffectsDrag(sound, event);
      return;
    }
    if (host !== "premiere") return;
    const nativeDropAccepted = event.dataTransfer
      && event.dataTransfer.dropEffect
      && event.dataTransfer.dropEffect !== "none";
    if (nativeDropAccepted || droppedOutsidePanel(event)) await organizeAudioAfterNativeDrop(sound);
  };

  const dragSelectedSegment = (event: DragEvent) => {
    if (!segmentSelection || !selected) {
      event.preventDefault();
      return;
    }
    if (host === "browser") {
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `${selected.name} (${segmentSelection.start.toFixed(2)}s–${segmentSelection.end.toFixed(2)}s)`);
      }
      return;
    }
    if (!preparedSegment) {
      segmentDragPreparation = prepareSelectedSegment(segmentSelection, false);
      segmentDragLeftPanel = false;
      segmentDragCancelled = false;
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("text/plain", `${selected.name} · preparing selected segment`);
      }
      notify("info", "Preparing the selected segment · release over Adobe to insert automatically.");
      return;
    }
    dragSound(preparedSegment, event);
  };

  const finishSelectedSegmentDrag = async (event: DragEvent) => {
    const pending = segmentDragPreparation;
    segmentDragPreparation = null;
    if (pending) {
      if (segmentDragCancelled || !droppedOutsidePanel(event, segmentDragLeftPanel)) return;
      const prepared = await pending;
      if (prepared && !segmentDragCancelled) await insertPreparedFromDrag(prepared);
      return;
    }
    if (preparedSegment) await finishSoundDrag(preparedSegment, event);
  };

  const markDragInsidePanel = () => {
    if (afterEffectsDragSession) afterEffectsDragSession.leftPanel = false;
    if (preparationDragSession) preparationDragSession.leftPanel = false;
    if (segmentDragPreparation) segmentDragLeftPanel = false;
  };

  const markDragOutsidePanel = (event: DragEvent) => {
    const related = event.relatedTarget;
    if ((related instanceof Node) && document.documentElement.contains(related)) return;
    if (afterEffectsDragSession) afterEffectsDragSession.leftPanel = true;
    if (preparationDragSession) preparationDragSession.leftPanel = true;
    if (segmentDragPreparation) segmentDragLeftPanel = true;
  };
</script>

<div class:sidebar-open={sidebarOpen || sidebarPinned} class:sidebar-pinned={sidebarPinned} class="app-shell" data-host={host}>
  <header class="topbar">
    <div class="brand-block"><span class="brand-mark"><Icon name="waveform" size={18} /></span><div><strong>SoundDesigner</strong><small>Library workspace</small></div></div>
    <IconButton icon="library" label="Toggle library drawer" onclick={() => { if (sidebarPinned) toggleSidebarPin(); sidebarOpen = !sidebarOpen; }} class="sidebar-toggle" active={sidebarOpen || sidebarPinned} pressed={sidebarOpen || sidebarPinned} />
    <IconButton icon="pin" label={sidebarPinned ? "Unpin library sidebar" : "Keep library sidebar visible"} onclick={toggleSidebarPin} active={sidebarPinned} pressed={sidebarPinned} />
    <div class="topbar-spacer"></div>
    <span class="host-pill tooltip" data-tooltip={`Connected to ${hostLabel(host)}`}><i></i>{hostLabel(host)}</span>
    {#if platform().runtime.setAlwaysOnTop}<IconButton icon="pin" label={alwaysOnTop ? "Unpin window" : "Keep window on top"} active={alwaysOnTop} pressed={alwaysOnTop} onclick={toggleAlwaysOnTop} />{/if}
    {#if platform().capabilities.nativeSfxAssistant}<IconButton icon="sparkles" label="Open SFX Assistant" onclick={() => sfxAssistantOpen = true} active={sfxAssistantOpen} pressed={sfxAssistantOpen} />{/if}
    <IconButton icon="activity" label="Open library status" active={!isIndexing} onclick={() => sidebarOpen = true} />
    <IconButton icon="settings" label="Open panel settings" onclick={() => { settingsFolderId = null; settingsOpen = true; }} />
  </header>

  <main class="panel-body" style={`--library-width: ${libraryWidth}px`}>
    <LibrarySidebar
      {folders} {sounds} {selectedFolder} query={folderQuery} indexing={isIndexing} {indexProgress} {now}
      {localSourceEnabled} {freesoundLibraryEnabled} {freesoundSourceEnabled}
      {cloudLibraryEnabled} onCloudLibraryEnabled={(enabled) => cloudLibraryEnabled = enabled}
      freesoundConnected={Boolean(freesoundApiKey)} freesoundCount={freesoundTotal}
      onSelectFolder={(id, keepOpen = false) => { setActiveTabFolder(id); if (filter === "favorites") { filter = "all"; favoriteCollection = "all"; } if (keepOpen) sidebarOpen = true; else if (!sidebarPinned) sidebarOpen = false; }}
      {collections} favoriteSounds={[...sounds.filter(sound => sound.favorite), ...savedCloudFavorites]}
      favoriteSelected={filter === "favorites" ? favoriteCollection : null}
      onSelectFavorites={(id) => { favoriteCollection = id; filter = "favorites"; updateSearchQuery(""); }}
      onQueryChange={(value) => folderQuery = value}
      onAddFolder={addFolder}
      onEditFolder={(id) => { settingsFolderId = id; settingsOpen = true; }}
      onFolderLabelColor={updateFolderLabel}
      onToggleFolderPinned={toggleFolderPinned}
      onRescan={rescanAll}
      onClose={() => { if (sidebarPinned) toggleSidebarPin(); sidebarOpen = false; }}
      onLocalSourceEnabled={(enabled) => localSourceEnabled = enabled}
      onFreesoundSourceEnabled={(enabled) => freesoundSourceEnabled = enabled}
      update={updateState}
      {updateDismissed}
      onOpenUpdate={openUpdate}
      onDismissUpdate={dismissAvailableUpdate}
    />

    <div
      aria-label="Library panel width"
      aria-orientation="vertical"
      aria-valuemax={LIBRARY_MAX_WIDTH}
      aria-valuemin={sidebarPinned ? 120 : LIBRARY_MIN_WIDTH}
      aria-valuenow={libraryWidth}
      aria-valuetext={`${libraryWidth} pixels wide`}
      class="library-resizer tooltip"
      data-tooltip="Drag left or right to resize library"
      onkeydown={resizeLibraryWithKeyboard}
      onmousedown={startLibraryResize}
      role="slider"
      tabindex="0"
    ></div>

    <button aria-label="Close library drawer" class="drawer-scrim" onclick={() => sidebarOpen = false} type="button"></button>

    <section class="search-workspace">
      <SearchTabs {tabs} activeId={activeTabId} onActivate={(id) => activeTabId = id} onAdd={addSearchTab} onClose={closeSearchTab} />
      <div bind:clientWidth={toolbarWidth} class:is-compact-toolbar={toolbarWidth < 260} class="search-toolbar">
        <label class="hero-search">
          <Icon name="search" />
          <input bind:this={searchInput} aria-label="Sound search" autocomplete="off" name="sound-search" oninput={(event) => updateSearchQuery(event.currentTarget.value)} placeholder={searchPlaceholder} spellcheck="false" value={activeTab?.query || ""} />
          {#if activeTab?.query}<IconButton icon="close" label="Clear search" onclick={() => updateSearchQuery("")} />{/if}
          <kbd>⌘ K</kbd>
        </label>
        <div class="compact-browse-bar">
        <ToolbarPopover label="Search scope" icon="folder" caption={toolbarWidth >= 580 ? folderBreadcrumb : ""}>
        <div class="browse-scope">
          <span class="tooltip" data-tooltip={filter === "favorites" ? "Favorites across all folders" : folderBreadcrumb}>{filter === "favorites" ? favoriteCollection === "all" ? "All favorites" : `Favorites / ${collections.find(item => item.id === favoriteCollection)?.name || "Main"}` : folderBreadcrumb}</span>
          {#if selectedFolder !== "all" && filter !== "favorites"}
            <label title="Include audio from nested folders"><input type="checkbox" bind:checked={includeSubfolders} /> Include subfolders</label>
            <button class="scope-button tooltip" aria-label="Search all sounds" data-tooltip="Search across the whole library" onclick={() => setActiveTabFolder("all")} type="button"><Icon name="search" size={12} /><span>Search all sounds</span></button>
          {/if}
        </div>
        </ToolbarPopover>
        <div class="search-actions">
          {#if toolbarWidth < 430}
            <select class="compact-filter-select tooltip" aria-label="Sound filters" data-tooltip="Filter sounds" value={filter} onchange={(event) => { filter = event.currentTarget.value as typeof filter; if (filter === "favorites") favoriteCollection = "all"; }}>
              {#each FILTERS as item (item.id)}<option value={item.id}>{item.label}{item.id === "favorites" ? ` (${favoriteCount})` : ""}</option>{/each}
            </select>
          {:else}
          <div class="filter-chips" aria-label="Sound filters" role="group">
            {#each FILTERS as item (item.id)}
              <button aria-pressed={filter === item.id} class:is-active={filter === item.id} onclick={() => { filter = item.id; if (item.id === "favorites") favoriteCollection = "all"; }} type="button">{item.label}{#if item.id === "favorites"}<span class="tiny-badge">{favoriteCount}</span>{/if}</button>
            {/each}
          </div>
          {/if}
          <IconButton icon={gridView ? "list" : "grid"} label={gridView ? "Switch to list view" : "Switch to waveform grid"} onclick={() => gridView = !gridView} active={gridView} pressed={gridView} />
          <ToolbarPopover label="Browse options" icon="sliders">
          <div class="browse-options">
          <span class="section-label">BROWSE OPTIONS</span>
          <div class="browse-option-row"><span>Color label</span>
          <ColorLabelPicker color={labelFilter} label="Filter by color label" onChange={(color) => labelFilter = color} />
          </div>
          <div class="browse-option-row"><span>Settings</span>
          <IconButton icon="sliders" label="Open search and library settings" onclick={() => { settingsFolderId = null; settingsOpen = true; }} />
          </div>
          <div class="browse-option-row"><span>Compact rows</span>
          <IconButton icon="list" label={compactResults ? "Use comfortable result density" : "Use compact result density"} active={compactResults} pressed={compactResults} onclick={toggleResultDensity} />
          </div>
          <div class="browse-option-row"><span>Hover audition</span>
          <IconButton icon="volume" label={hoverPreview ? "Disable hover audition" : "Enable hover audition (350 ms delay)"} onclick={() => hoverPreview = !hoverPreview} active={hoverPreview} pressed={hoverPreview} />
          </div>
          {#if gridView}<label class="browse-option-row">Tile size<input class="tile-size-control tooltip" data-tooltip="Waveform tile size" aria-label="Waveform tile size" type="range" min="120" max="240" step="10" bind:value={tileSize} /></label>{/if}
          </div>
          </ToolbarPopover>
        </div>
        </div>
      </div>

      <div class="results-summary">
        <span>
          {#if cloudSourceActive && freesoundStatus === "loading" && !visibleSounds.length}
            Searching Freesound…
          {:else}
            <strong>{visibleSounds.length}</strong> results
            {#if localSourceEnabled && cloudSourceActive}
              <small class="results-source-breakdown">{localVisibleSounds.length} local · {freesoundVisibleSounds.length}{freesoundTotal > freesoundVisibleSounds.length ? ` of ${freesoundTotal.toLocaleString()}` : ""} cloud</small>
            {:else if cloudSourceActive && freesoundTotal > freesoundVisibleSounds.length}
              <small class="results-source-breakdown">{freesoundVisibleSounds.length} of {freesoundTotal.toLocaleString()} cloud</small>
            {/if}
          {/if}
        </span>
        <div class="results-summary__actions">
          <span>Sorted by <button aria-label={`Change result sorting. Current sort: ${sortLabel}`} class="tooltip" data-tooltip="Change result sorting" onclick={cycleSortMode} type="button">{sortLabel} <Icon name="chevron" size={12} /></button></span>
          <IconButton
            icon="waveform"
            label={compactPreviewOpen ? "Close preview and show results" : "Show spectrum preview"}
            onclick={() => { if (compactPreviewOpen) closePreview(); else if (selected) compactPreviewOpen = true; }}
            active={compactPreviewOpen}
            pressed={compactPreviewOpen}
            class="compact-preview-toggle"
          />
        </div>
      </div>

      <div
        class:is-preview-open={compactPreviewOpen}
        class:has-effects={effectsOpen}
        class:has-selection={Boolean(selected)}
        class="search-content"
      >
        <div
          bind:this={resultsList}
          bind:clientHeight={resultsViewportHeight}
          bind:clientWidth={resultsViewportWidth}
          class:is-grid={gridView}
          class:is-short-results={resultsViewportHeight < 220}
          style={`--tile-columns: ${gridColumns}`}
          class:is-relaxed={!compactResults}
          class="results-list"
          role="listbox"
          aria-label="Sound results"
          onscroll={handleResultsScroll}
        >
          {#if !localSourceEnabled && !cloudSourceActive}
            <div class="empty-state empty-state--library">
              <span class="empty-glyph"><Icon name="library" size={22} /></span>
              <strong>Select a search source</strong>
              <span>{freesoundLibraryEnabled ? "Enable Local, Freesound, or both from the Library panel." : "Enable Local from the Library panel or enable Freesound in Settings."}</span>
            </div>
          {:else if visibleSounds.length}
            {#if virtualTopSpace}<div class="results-spacer" style:height={`${virtualTopSpace}px`}></div>{/if}
            {#each renderedSounds as sound (sound.id)}
              <SoundRow
                {sound}
                channels={sound.id === selectedId ? previewChannels : EMPTY_WAVEFORM_CHANNELS}
                selected={sound.id === selectedId}
                playing={playing && sound.id === selectedId}
                progress={sound.id === selectedId ? progress : 0}
                preparation={soundPreparation[sound.id]}
                dragHint={isCloudSound(sound) && !sound.path
                  ? soundPreparation[sound.id] ? "Preparing automatically…" : "Drag to prepare automatically"
                  : host === "aftereffects" ? "Drag into the active composition" : "Drag to host (support varies)"}
                onSelect={() => selectSound(sound.id)}
                onHover={() => auditionHover(sound)}
                onLeave={() => { if (hoverSoundId === sound.id) stopHover(); }}
                onPlay={() => { stopHover(); compactPreviewOpen = true; if (sound.id !== selectedId || (sound.source === "scorpion" && !sound.previewUrl && !sound.path)) { pendingPlayId = sound.id; selectedId = sound.id; } else togglePlay(); }}
                onInsert={() => { selectedId = sound.id; insertSelected(sound); }}
                onFavorite={() => toggleFavorite(sound)}
                onLabelColor={(color) => updateSoundLabel(sound, color)}
                onDragPrepare={() => prepareSoundForDrag(sound)}
                onDragStart={(event) => dragSound(sound, event)}
                onDragEnd={(event) => finishSoundDrag(sound, event)}
              />
            {/each}
            {#if virtualBottomSpace}<div class="results-spacer" style:height={`${virtualBottomSpace}px`}></div>{/if}
            {#if cloudSourceActive && freesoundHasNext}
              <button class="load-more-button" disabled={freesoundStatus === "loading"} onclick={loadMoreFreesound} type="button">
                {#if freesoundStatus === "loading"}<span class="spinner"></span>{:else}<Icon name="cloud" size={14} />{/if}
                Load more from Freesound
              </button>
            {/if}
          {:else if localSourceEnabled && !folders.length && cloudSourceActive && !cloudLibraryEnabled && !freesoundApiKey}
            <div class="empty-state empty-state--library">
              <span class="empty-glyph"><Icon name="library" size={22} /></span>
              <strong>Set up a sound source</strong>
              <span>Add a local folder or connect Freesound. Both sources can be searched together.</span>
              <div class="empty-state-actions">
                <button class="ghost-button" onclick={addFolder} type="button"><Icon name="folder" /> Add folder</button>
                <button class="primary-button" onclick={() => { settingsFolderId = null; settingsOpen = true; }} type="button"><Icon name="settings" /> Connect Freesound</button>
              </div>
            </div>
          {:else if cloudSourceActive && !cloudLibraryEnabled && !freesoundApiKey}
            <div class="empty-state empty-state--cloud">
              <span class="empty-glyph"><Icon name="cloud" size={22} /></span>
              <strong>Connect Freesound</strong>
              <span>Local matches remain available. Add your personal API key to include CC0 and CC BY cloud results.</span>
              <button class="primary-button" onclick={() => { settingsFolderId = null; settingsOpen = true; }} type="button"><Icon name="settings" /> Open settings</button>
            </div>
          {:else if cloudSourceActive && freesoundStatus === "loading" && !freesoundSounds.length}
            <div class="results-loading" aria-live="polite" aria-label="Searching cloud sounds">
              {#each Array(5) as _, index (index)}<div class="sound-row-skeleton"><i></i><span></span><b></b></div>{/each}
            </div>
          {:else if cloudSourceActive && freesoundStatus === "error" && !freesoundSounds.length}
            <div class="empty-state empty-state--cloud">
              <span class="empty-glyph"><Icon name="cloud" size={22} /></span>
              <strong>Cloud search is unavailable</strong>
              <span>{freesoundError}</span>
              <button class="ghost-button" onclick={() => freesoundRefreshNonce += 1} type="button"><Icon name="refresh" /> Try again</button>
            </div>
          {:else if cloudSourceActive && !localSourceEnabled && (activeTab?.query.trim().length || 0) < 2}
            <div class="empty-state empty-state--cloud">
              <span class="empty-glyph"><Icon name="search" size={22} /></span>
              <strong>Search the cloud library</strong>
              <span>Type at least two characters. Cloud results are loaded only when you search.</span>
            </div>
          {:else if cloudSourceActive && freesoundSounds.length && !freesoundVisibleSounds.length}
            <div class="empty-state">
              <span class="empty-glyph"><Icon name="sliders" size={22} /></span>
              <strong>Cloud results are hidden by filters</strong>
              <span>{freesoundSounds.length} cloud sounds were found. Clear the category and color filters to show them.</span>
              <button class="ghost-button" onclick={() => { filter = "all"; labelFilter = undefined; }} type="button">Clear filters</button>
            </div>
          {:else if localSourceEnabled && !folders.length}
            <div class="empty-state empty-state--library">
              <span class="empty-glyph"><Icon name="folder" size={22} /></span>
              <strong>Add your sound library</strong>
              <span>Choose a top-level folder. SoundDesigner will preserve every nested folder in the library tree.</span>
              <button class="primary-button" onclick={addFolder} type="button"><Icon name="add" /> Add sound folder</button>
            </div>
          {:else}
            <div class="empty-state">
              <span class="empty-glyph"><Icon name="waveform" size={22} /></span>
              <strong>No sounds found</strong>
              <span>{selectedFolder === "all" ? "Try fewer keywords or clear the active filters." : "No matching audio in this folder. Include subfolders or search all sounds."}</span>
              <div class="empty-state-actions">
                <button class="ghost-button" onclick={() => { updateSearchQuery(""); filter = "all"; labelFilter = undefined; }} type="button">Clear search and filters</button>
                {#if selectedFolder !== "all"}<button class="ghost-button" onclick={() => setActiveTabFolder("all")} type="button">Search all sounds</button>{/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    </section>
  </main>

  <Transport
    sound={selected} {playing} {progress} {loop} {processing} processingBusy={processingPreviewBusy} busy={insertBusy} {effectsOpen}
    segmentDuration={segmentSelection ? segmentSelection.end - segmentSelection.start : 0}
    onPrevious={() => moveSelection(-1)}
    onTogglePlay={togglePlay}
    onNext={() => moveSelection(1)}
    onStop={stopPlayback}
    onLoop={() => loop = !loop}
    onToggleEffects={() => effectsOpen = !effectsOpen}
    onInsert={() => insertSelected()}
    onRemove={removeSelectedFromIndex}
  >
    {#snippet waveform()}
        <PreviewPane
          sound={selected}
          channels={previewChannels}
          channelsLoading={waveformChannelsLoading}
          {progress}
          {zoom}
          reversed={!processing.bypass && processing.reverse}
          selection={segmentSelection}
          {segmentPreparing}
          segmentReady={host === "browser" ? Boolean(segmentSelection) : Boolean(preparedSegment)}
          onSeek={seek}
          onZoomIn={() => zoom = Math.min(3, zoom + 0.5)}
          onZoomOut={() => zoom = Math.max(1, zoom - 0.5)}
          onSelectionChange={updateSegmentSelection}
          onSegmentDragStart={dragSelectedSegment}
          onSegmentDragEnd={finishSelectedSegmentDrag}
          onProcessing={updateProcessing}
          onClose={closePreview}
        />
    {/snippet}
  </Transport>

  {#if effectsOpen && selected}
    <EffectsRack
      sound={selected} {processing} processingBusy={processingPreviewBusy} processingError={processingPreviewError}
      segmentDuration={segmentSelection ? segmentSelection.end - segmentSelection.start : 0}
      onProcessing={updateProcessing}
      onReset={() => updateProcessing({ ...DEFAULT_AUDIO_PROCESSING })}
      onClose={() => effectsOpen = false}
    />
  {/if}

  <div class="toast-stack" aria-live="polite">
    {#each toasts as toast (toast.id)}
      <div class={`toast toast--${toast.type}`}><span>{toast.type === "success" ? "✓" : toast.type === "error" ? "!" : toast.type === "warning" ? "△" : "i"}</span>{toast.message}</div>
    {/each}
  </div>

  {#if floatingTooltip}
    <div class:is-above={floatingTooltip.above} class:is-below={!floatingTooltip.above} class="floating-tooltip" role="tooltip" style:left={`${floatingTooltip.x}px`} style:top={`${floatingTooltip.y}px`}>{floatingTooltip.text}</div>
  {/if}

  <SettingsSheet
    open={settingsOpen} folder={settingsFolder} {autoPreview} {loop} {insertionTarget} {conversionPolicy} {normalization} {normalizationTargetDb} {freesoundLibraryEnabled} {freesoundApiKey} {freesoundLicenseFilter} storagePath={storageInfo?.root || ""} storageAvailable={platform().capabilities.nativeStorage} {storageBusy} update={updateState}
    onAutoPreview={(value) => autoPreview = value}
    onLoop={(value) => loop = value}
    onInsertionTarget={(value) => insertionTarget = value}
    onConversionPolicy={(value) => conversionPolicy = value}
    onNormalization={(value) => {
      normalization = value;
      invalidatePreparedSegment();
    }}
    onNormalizationTargetDb={(value) => {
      normalizationTargetDb = normalizeTargetDb(value);
      invalidatePreparedSegment();
    }}
    onFreesoundLibraryEnabled={(enabled) => {
      freesoundLibraryEnabled = enabled;
      freesoundSourceEnabled = enabled;
    }}
    onFreesoundApiKey={saveFreesoundApiKey}
    onFreesoundLicenseFilter={(value) => freesoundLicenseFilter = value}
    onOpenFreesoundSetup={() => void platform().runtime.openExternal("https://freesound.org/apiv2/apply/")}
    onOpenFreesoundTerms={() => void platform().runtime.openExternal("https://freesound.org/help/tos_api/")}
    onBrowseFreesound={() => void platform().runtime.openExternal("https://freesound.org/search/")}
    onCheckUpdate={refreshUpdates}
    onOpenUpdate={openUpdate}
    onChangeStorage={changeStorageLocation}
    onClose={() => settingsOpen = false}
    onDelete={deleteSettingsFolder}
  />
  <SfxAssistantSheet
    open={sfxAssistantOpen} {sounds} {folders} cloudEnabled={cloudLibraryEnabled}
    onClose={() => sfxAssistantOpen = false}
    onStopPreview={stopPlayback}
    onPrepareRemote={prepareAssistantSound}
    onNotice={notify}
  />
  <FavoriteSheet sound={favoriteEditing} {collections} onSave={saveFavorite} onCreate={createCollection} onClose={() => favoriteEditing = null} />
</div>
