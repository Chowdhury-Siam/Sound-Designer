import assert from "node:assert/strict";
import { mock } from "bun:test";
import { readFile } from "node:fs/promises";
import { registerPlatform } from "../src/js/platform/client";
import { createResolvePlatform } from "../resolve/src/renderer/bridge";
import { searchTabLabel } from "../src/js/main/searchTabs";

// Exercise the authoritative feature modules with the same sandbox boundary as Resolve.
mock.module("../src/js/lib/utils/bolt", () => ({ csi: { getSystemPath: () => "" } }));
const records = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value) };
const calls: string[] = [];
let downloadListener: ((progress: any) => void) | undefined;
let scanListener: ((progress: any) => void) | undefined;
let downloadSubscriptions = 0;
let nativeMetadata: any = null;
const ok = (data: unknown) => ({ ok: true, data });
const details = { path: "C:\\Shared\\Downloads\\hit.mp3", size: 8, modifiedAt: 42, projectRoot: "C:\\Shared" };
(globalThis as any).window = {
  setTimeout, clearTimeout,
  soundDesigner: {
    runtime: { mode: "resolve", setAlwaysOnTop: async (value: boolean) => ok({ alwaysOnTop: value }), getLatestRelease: async () => { calls.push("updates"); return ok({ notModified: false, release: { tag_name: "v1.0.4", html_url: "https://github.com/iboyshanto/SoundDesigner/releases/tag/v1.0.4", assets: [] } }); } },
    cloud: {
      searchCloudSfx: async () => { calls.push("cloud-search"); return ok([{ id: "987", name: "Whoosh" }]); },
      readCloudSfxPreview: async () => { calls.push("cloud-preview"); return ok(new Uint8Array([1, 2, 3])); },
      searchFreesound: async () => { calls.push("freesound-search"); return ok({ results: [{ id: 7, name: "Hit.wav", url: "https://freesound.org/s/7/", previews: { "preview-hq-mp3": "https://cdn.freesound.org/7.mp3" } }], count: 1 }); },
      onDownloadProgress: (listener: any) => { downloadListener = listener; downloadSubscriptions++; return () => { downloadListener = undefined; downloadSubscriptions--; }; },
      downloadCloudSfx: async (value: any) => { calls.push("cloud-download"); downloadListener?.({ operationId: value.operationId, receivedBytes: 4, totalBytes: 8, progress: 0.5 }); return ok(details); },
      downloadFreesound: async () => { calls.push("freesound-download"); return ok(details); },
      cancel: async () => ok({ cancelled: true }),
    },
    audio: {
      readFile: async () => { calls.push("read-file"); return ok(new Uint8Array([1, 2, 3])); },
      writePrepared: async (value: any) => { structuredClone(value); calls.push("write-prepared"); assert.equal(value.projectId, "project-1"); assert.ok(value.bytes.length > 44); return ok({ ...details, path: "C:\\Shared\\Converted\\hit.wav" }); },
    },
    library: { onScanProgress: (listener: any) => { scanListener = listener; return () => { scanListener = undefined; }; } },
    storage: {
      getLibraryMetadata: async () => ok(nativeMetadata),
      saveLibraryMetadata: async (value: any) => { nativeMetadata = parsePortableLibraryMetadata(structuredClone(value)); return ok({ saved: true }); },
    },
    resolve: {
      ensureBin: async () => { throw new Error("Redundant bin/import before insertion"); },
      importAudio: async () => { throw new Error("Redundant import before insertion"); },
      insertAudio: async (value: any) => { assert.equal(value.channelMode, "mono"); assert.equal(value.projectId, "project-1"); calls.push("insert"); return ok({ trackIndex: 1, target: "timeline-track" }); },
      analyzeSfx: async () => ok({ timelineId: "timeline-1", timelineName: "Main", frameRate: 24, analyzedItems: 1, moments: [{ frame: 86424, time: 1, duration: 1, intensity: 1, type: "click", source: "item", reason: "edit" }] }),
      placeSfx: async (value: any) => { assert.equal(value.placements[0].recordFrame, 86414); assert.equal(value.placements[0].channelMode, "mono"); assert.equal(value.placements[0].sourceId, "short-id"); calls.push("sfx"); return ok({ placed: 1 }); },
    },
  },
};
registerPlatform(createResolvePlatform());
const { parsePortableLibraryMetadata, parsePortablePreferences } = await import("../resolve/src/shared/contracts");
globalThis.fetch = (async () => { throw new Error("Resolve must use its native network service."); }) as typeof fetch;
const { searchCloudLibrary, resolveCloudPreview } = await import("../src/js/main/cloudLibrary");
const { searchFreesound } = await import("../src/js/main/freesound");
const { fileUrl, sameNativePath, folderNameFromPath, audioExtensionFromPath, normalizeDialogPath } = await import("../src/js/main/library");
assert.equal(sameNativePath("/Volumes/SFX/Cafe\u0301/Hit.wav", "/Volumes/SFX/Café/Hit.wav"), true);
assert.equal(sameNativePath("/Volumes/SFX/Hit.wav", "/Volumes/SFX/hit.wav"), false);
assert.equal(sameNativePath("/Volumes/SFX/Folder\\", "/Volumes/SFX/Folder"), false);
assert.equal(sameNativePath("/Volumes/SFX/Folder/", "/Volumes/SFX/Folder"), true);
assert.equal(folderNameFromPath("/Volumes/SFX/Hit\\Reverse/"), "Hit\\Reverse");
assert.equal(folderNameFromPath("/Volumes/SFX/Folder\\"), "Folder\\");
assert.equal(audioExtensionFromPath("/Volumes/SFX/Hit.wav\\Reverse"), "wav\\reverse", "POSIX backslashes must not split audio filenames");
assert.equal(folderNameFromPath("C:\\SFX\\Folder\\"), "Folder");
assert.equal(audioExtensionFromPath("C:\\SFX\\Hit.WAV"), "wav");
assert.equal(sameNativePath("C:\\SFX\\HIT.wav", "c:\\sfx\\hit.wav"), true);
assert.equal(normalizeDialogPath("/Volumes/SFX/100%20 Literal%"), "/Volumes/SFX/100%20 Literal%");
assert.equal(normalizeDialogPath("file:///Volumes/SFX/100%2520%20Literal%25"), "/Volumes/SFX/100%20 Literal%");
const { checkForUpdates } = await import("../src/js/main/updater");
const { prepareAudioForHost, prepareAudioSegmentForHost } = await import("../src/js/main/projectAudio");
const cloud = await searchCloudLibrary("whoosh");
assert.equal(cloud.length, 1, "Native search records have no renderer preview_key field");
assert.ok((await resolveCloudPreview(cloud[0])).startsWith("blob:"));
const freesound = await searchFreesound("hit", "test-key", "all");
assert.equal(freesound.sounds.length, 1);
assert.ok(fileUrl("C:\\SFX\\音.wav").startsWith("sounddesigner://media/"));
const macMediaPath = "/Volumes/Audio Library/Cafe\u0301/音 #1\\Reverse.wav";
assert.equal(Buffer.from(new URL(fileUrl(macMediaPath)).pathname.slice(1), "base64url").toString("utf8"), macMediaPath, "Resolve media URLs must preserve raw Mac paths");
registerPlatform({ ...createResolvePlatform(), mode: "adobe" });
assert.equal(fileUrl(macMediaPath), "file:///Volumes/Audio%20Library/Cafe%CC%81/%E9%9F%B3%20%231%5CReverse.wav", "Adobe media URLs must encode POSIX backslashes, not turn them into directories");
registerPlatform(createResolvePlatform());
assert.equal((await checkForUpdates(true)).status, "current");

const samples = new Float32Array(80).fill(0.2);
(window as any).AudioContext = class {
  async decodeAudioData() { return { sampleRate: 8000, length: samples.length, duration: 0.01, numberOfChannels: 1, getChannelData: () => samples }; }
  async close() {}
};
const options = { host: "resolve" as const, project: { ok: true, host: "resolve" as const, projectPath: "resolve:project-1", message: "ready" }, conversionPolicy: "unsupported" as const, normalization: "preserve" as const, normalizationTargetDb: -1 };
const { decodeAudioWaveformChannels } = await import("../src/js/main/audioWaveform");
assert.equal((await decodeAudioWaveformChannels(details.path, details.size, details.modifiedAt, 0.01)).length, 1, "Local waveform must read through the native bridge without CEP");
const downloadProgress: number[] = [];
for (const sound of [cloud[0], freesound.sounds[0]]) {
  const prepared = await prepareAudioForHost(sound, { ...options, onProgress: (_stage, _message, progress) => { if (progress !== undefined) downloadProgress.push(progress); } });
  assert.equal(prepared.downloaded, true);
  assert.equal(prepared.sound.extension, "wav");
  assert.equal(prepared.sound.originalPath, details.path);
}
assert.deepEqual(downloadProgress, [0.5]);
assert.equal(downloadSubscriptions, 0, "Download subscriptions must be removed");
const { DEFAULT_AUDIO_PROCESSING } = await import("../src/js/main/audioEffects");
const reactiveFx = new Proxy({ ...DEFAULT_AUDIO_PROCESSING, gainDb: 3 }, {});
assert.throws(() => structuredClone(reactiveFx));
const local = { ...cloud[0], source: "local" as const, path: "C:\\SFX\\hit.wav", extension: "wav", size: 8, modifiedAt: 42 };
const fx = await prepareAudioForHost(local, { ...options, processing: reactiveFx });
assert.equal(fx.sound.channels, 1);
assert.equal((await createResolvePlatform().handoff.insertAudio({ path: fx.sound.path, name: "Hit", targetAudioTrack: -1, channelMode: "mono", projectPath: options.project.projectPath })).ok, true);
await prepareAudioSegmentForHost(local, { start: 0, end: 0.05 }, { ...options, processing: reactiveFx });
// Run the actual native-drag branch from the shared App with a synthetic drag event.
const app = await readFile(new URL("../src/js/main/App.svelte", import.meta.url), "utf8");
const snapshotFunction = app.match(/const applyNativeLibrarySnapshot = [\s\S]*?\n  \};/)?.[0];
assert.ok(snapshotFunction);
const snapshotCode = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(snapshotFunction);
const searchTabs = [{ id: "search-library", label: "whoosh", query: "whoosh", folderId: "all" }, { id: "search-2", label: "hit", query: "hit", folderId: "all" }];
const runSnapshot = new Function("selection", "freesoundSounds", "savedCloudFavorites", "snapshot", "initialTabs", "searchTabLabel", `
  let selectedId = selection, folders = [], sounds = [];
  let tabs = initialTabs, activeTabId = "search-library";
  const hydrateLibraryMetadata = (folders, sounds) => ({ folders, sounds });
  const folderNameForId = () => "";
  ${snapshotCode}
  applyNativeLibrarySnapshot(snapshot);
  applyNativeLibrarySnapshot(snapshot);
  return { tabs, activeTabId, selectedId, sounds };
`);
const refreshSnapshot = (selection: string, cloud: unknown[], favorites: unknown[], snapshot: unknown, tabs: unknown[]) => runSnapshot(selection, cloud, favorites, snapshot, tabs, searchTabLabel);
for (const [liveCloud, favorites] of [[[cloud[0]], []], [[], [cloud[0]]]]) {
  const refreshed = refreshSnapshot(cloud[0].id, liveCloud, favorites, { folders: [], sounds: [] }, searchTabs);
  assert.equal(refreshed.tabs, searchTabs, "Focus/visibility refresh must preserve every search tab even without local folders");
  assert.equal(refreshed.activeTabId, "search-library");
  assert.equal(refreshed.selectedId, cloud[0].id, "Native library refresh must retain the selected cloud sound");
}
assert.equal(refreshSnapshot(local.id, [], [], { folders: [], sounds: [] }, searchTabs).selectedId, "", "Deleted local sounds must still lose selection");
assert.equal(refreshSnapshot(local.id, [], [], { folders: [], sounds: [local] }, searchTabs).selectedId, local.id);
const scopedTabs = [{ ...searchTabs[0], folderId: "removed-folder" }, searchTabs[1]];
const afterRemoval = refreshSnapshot("", [], [], { folders: [], sounds: [] }, scopedTabs);
assert.equal(afterRemoval.tabs[0].folderId, "all", "Removing the last local folder must leave a usable search scope");
assert.equal(afterRemoval.tabs[0].query, "whoosh", "Scope fallback must not erase the search");
assert.equal(afterRemoval.tabs[1], scopedTabs[1], "Unaffected cloud tabs must retain identity");

const nativeMain = await readFile(new URL("../resolve/src/main/main.ts", import.meta.url), "utf8");
const brandingStart = nativeMain.indexOf('  const userDataPath = app.getPath("userData");');
assert.ok(brandingStart >= 0);
const brandingCode = nativeMain.slice(brandingStart, nativeMain.indexOf("\n  registerUiProtocol();", brandingStart));
for (const platform of ["darwin", "win32"]) for (const loadFails of [false, true]) {
  let userDataPath = "/existing/Electron";
  let appName = "Electron";
  let dockIcon: unknown;
  let menu: any;
  const loads: string[] = [];
  const errors: unknown[][] = [];
  const windowIcon = {};
  new Function("app", "Menu", "WINDOW_ICON", "process", "createRequire", "path", "getPluginRoot", "console", brandingCode)({
    getPath: () => userDataPath,
    setName: (name: string) => { appName = name; userDataPath = "/new/SoundDesigner"; },
    setPath: (name: string, value: string) => { assert.equal(name, "userData"); userDataPath = value; },
    dock: platform === "darwin" ? { setIcon: (icon: unknown) => { dockIcon = icon; } } : undefined,
  }, { buildFromTemplate: (template: unknown) => template, setApplicationMenu: (value: unknown) => { menu = value; } }, windowIcon, { platform },
    (file: string) => {
      assert.equal(file, "/plugin/package.json");
      return (module: string) => {
        assert.ok(menu, "Native bridge must load after Electron installs its menu");
        loads.push(module);
        if (loadFails) throw new Error("Native load fixture");
      };
    }, { join: (...parts: string[]) => parts.join("/") }, () => "/plugin", { error: (...args: unknown[]) => errors.push(args) });
  assert.equal(appName, "SoundDesigner");
  assert.equal(userDataPath, "/existing/Electron", "Branding must not move existing Chromium state or legacy storage");
  if (platform === "darwin") {
    assert.equal(dockIcon, windowIcon);
    assert.equal(menu[0].label, "SoundDesigner");
    assert.deepEqual(loads, ["/plugin/macos-menu.node"], "Load only the plugin-local Mac bridge");
    assert.equal(errors.length, loadFails ? 1 : 0, "A failed branding helper must not abort startup");
    assert.ok(menu[0].submenu.some((item: any) => item.role === "quit"));
    assert.ok(menu.some((item: any) => item.role === "editMenu"), "Native copy/paste shortcuts must remain available");
  } else {
    assert.equal(dockIcon, undefined);
    assert.equal(menu, undefined);
    assert.deepEqual(loads, [], "Windows must not load the AppKit bridge");
    assert.deepEqual(errors, []);
  }
}
const dragBranch = app.match(/if \(host === "resolve"\) \{\s*event\.preventDefault\(\);[\s\S]*?\n      return;\n    \}/)?.[0];
assert.ok(dragBranch, "Shared drag handler must cancel Chromium drag before Electron startDrag");
let cancelled = false;
let dragged = false;
new Function("host", "event", "platform", "sound", "activeProjectPath", "notify", dragBranch)("resolve", { preventDefault: () => { cancelled = true; } }, () => ({ audio: { startDrag: async () => { assert.equal(cancelled, true); dragged = true; return ok({}); } } }), local, "resolve:project-1", () => {});
assert.equal(dragged, true);
for (const call of ["cloud-search", "cloud-preview", "freesound-search", "cloud-download", "freesound-download", "read-file", "write-prepared", "updates"]) assert.ok(calls.includes(call), call);
const adapter = createResolvePlatform();
assert.deepEqual(await adapter.runtime.setAlwaysOnTop!(true), ok({ alwaysOnTop: true }));
assert.deepEqual(await adapter.runtime.setAlwaysOnTop!(false), ok({ alwaysOnTop: false }));
let scanFiles = 0;
const stopScanProgress = adapter.library.onScanProgress!(progress => { scanFiles = progress.files; });
scanListener!({ files: 12, folders: 3, currentPath: "C:\\SFX" });
assert.equal(scanFiles, 12);
stopScanProgress();
assert.equal(scanListener, undefined);
await adapter.sfx.analyze("comp", "balanced");
assert.equal((await adapter.sfx.place(1, [{ frame: 86426, time: 1 + 2 / 24, path: fx.sound.path, name: "Hit", sourceId: "short-id", channels: 1, peakOffset: 0.5, gainDb: -8 }])).ok, true);
assert.equal((await adapter.sfx.place(1, [{ time: 1, path: fx.sound.path, name: "Hit", peakOffset: 0, gainDb: -8 }])).ok, false, "Missing absolute frames must fail closed");
assert.ok(calls.includes("sfx"));
const readPaths: string[] = [];
window.soundDesigner!.audio.readFile = async (path: string) => { readPaths.push(path); return ok(new Uint8Array([1, 2, 3])) as any; };
const processed = { ...local, path: "C:\\SFX\\processed.wav", originalPath: "C:\\SFX\\original.wav", originalExtension: "wav" };
await prepareAudioSegmentForHost(processed, { start: 0, end: 0.05 }, options);
assert.deepEqual(readPaths, [processed.originalPath], "Segments must read the original, not the FX output");
const quiet = await prepareAudioForHost(local, { ...options, conversionPolicy: "always", processing: { ...DEFAULT_AUDIO_PROCESSING, gainDb: -48 } });
assert.equal(quiet.sound.channels, 1);
assert.ok(quiet.gainDb < -47.9, "Assistant must support its full gain range");
const sheet = await readFile(new URL("../src/js/main/components/SfxAssistantSheet.svelte", import.meta.url), "utf8");
assert.ok(sheet.includes("(isResolve || !sound.path)"), "Assistant must prepare local Resolve files too");
assert.ok(sheet.includes("isResolve ? Number(gainDb) : undefined"));
assert.ok(app.includes("onPrepareRemote={prepareAssistantSound}"));
const assistantFunction = app.match(/const prepareAssistantSound = [\s\S]*?\n  };/)?.[0];
assert.ok(assistantFunction);
const assistantCode = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(assistantFunction!);
let assistantOptions: any;
const prepareAssistant = new Function("host", "prepareSound", "getHostProjectContext", "prepareAudioForHost", "normalization", "normalizationTargetDb", "normalizeAudioProcessing", "DEFAULT_AUDIO_PROCESSING", `${assistantCode}\nreturn prepareAssistantSound;`)(
  "resolve", () => { throw new Error("Resolve assistant must not use ordinary preparation"); },
  async () => options.project,
  async (sound: any, requested: any) => { assistantOptions = requested; return prepareAudioForHost(sound, requested); },
  "preserve", -1, (await import("../src/js/main/audioEffects")).normalizeAudioProcessing, DEFAULT_AUDIO_PROCESSING,
);
const assistantSound = await prepareAssistant({ ...local, extension: "mp3", path: "C:\\SFX\\assistant.mp3" }, -48);
assert.equal(assistantOptions.conversionPolicy, "always");
assert.equal(assistantOptions.processing.gainDb, -48);
assert.equal(assistantSound.extension, "wav");
assert.equal(assistantSound.channels, 1);
assert.ok(app.includes("platform().library.onScanProgress?."));
assert.ok(app.includes("onclick={toggleAlwaysOnTop}"));
const warmBody = app.match(/\/\/ Prepare selected local audio[\s\S]*?\$effect\(\(\) => \{([\s\S]*?)\n  \}\);/)?.[1];
assert.ok(warmBody);
const warmCode = new Bun.Transpiler({ loader: "ts", target: "browser" }).transformSync(`const warmSelected = () => {${warmBody}};`);
let warmCallback: (() => void) | undefined;
let warmed = 0;
let cleared = 0;
const warmWindow = { setTimeout: (callback: () => void, delay: number) => { assert.equal(delay, 250); warmCallback = callback; return 1; }, clearTimeout: () => { cleared++; } };
const createWarmSelected = (host: string, selected: any) => new Function("host", "selected", "isCloudSound", "requiresProjectAudioPreparation", "conversionPolicy", "normalization", "processing", "normalizationTargetDb", "window", "prepareSound", `${warmCode}\nreturn warmSelected;`)(
  host, selected, (sound: any) => sound.source === "scorpion" || sound.source === "freesound", () => true,
  "unsupported", "preserve", DEFAULT_AUDIO_PROCESSING, -1, warmWindow, async () => { warmed++; },
);
const cancelWarm = createWarmSelected("resolve", local)();
assert.equal(typeof cancelWarm, "function");
warmCallback!();
assert.equal(warmed, 1);
cancelWarm();
assert.equal(cleared, 1);
warmCallback = undefined;
assert.equal(createWarmSelected("premiere", local)(), undefined);
assert.equal(createWarmSelected("resolve", cloud[0])(), undefined);
assert.equal(warmCallback, undefined, "Adobe and cloud selection must not trigger eager handoffs");
const ipc = await readFile(new URL("../resolve/src/main/ipc/register.ts", import.meta.url), "utf8");
assert.ok(ipc.includes("https://api.github.com/repos/iboyshanto/SoundDesigner/releases/latest"), "Native endpoint must match the shared updater trust boundary");
assert.ok(!ipc.includes("https://api.github.com/repos/its-niloy/SoundDesigner-Resolve/releases/latest"));
const preferences = { autoPreview: true, loop: false, localSourceEnabled: true, cloudLibraryEnabled: true, freesoundLibraryEnabled: true, freesoundSourceEnabled: true, insertionTarget: "playhead", conversionPolicy: "unsupported", normalization: "manual", normalizationTargetDb: 0, freesoundLicenseFilter: "all" };
assert.equal(parsePortablePreferences(preferences).normalizationTargetDb, 0);
assert.equal(parsePortablePreferences({ ...preferences, normalizationTargetDb: NaN }).normalizationTargetDb, -3);
assert.equal(parsePortablePreferences({ ...preferences, normalizationTargetDb: -99 }).normalizationTargetDb, -24);
const metadataKey = "sounddesigner.library-metadata.v1";
const legacyKey = "sounddesigner.resolve.library-metadata.v1";
const fileKey = "file:c:\\sfx\\hit.wav";
records.set(metadataKey, JSON.stringify({ version: 1, sounds: { [fileKey]: { waveform: [0.2, 0.8], waveformFingerprint: "c:\\sfx\\hit.wav:8:42" } }, folders: {} }));
records.set(legacyKey, JSON.stringify({ version: 1, sounds: { "scorpion:987": { favorite: true, favoriteCollection: "old", cloudSound: { ...cloud[0], waveform: undefined } } }, folders: {}, collections: [{ id: "old", name: "Old memories", parentId: "" }] }));
nativeMetadata = { version: 1, sounds: { "freesound:7": { favorite: true }, [fileKey]: { favorite: false }, "file:/Volumes/SFX/Cafe\u0301/Old.wav": { favorite: true } }, folders: {} };
const { loadPortableLibraryMetadata, hydrateLibraryMetadata, loadFavoriteCollections, saveSoundMetadata, flushLibraryMetadata } = await import("../src/js/main/libraryMetadata");
await loadPortableLibraryMetadata();
assert.equal(hydrateLibraryMetadata([], [{ ...local, path: "/Volumes/SFX/Café/Old.wav" }]).sounds[0].favorite, true, "Existing decomposed Mac metadata must remain readable");
assert.equal(hydrateLibraryMetadata([], [cloud[0]]).sounds[0].favorite, true);
assert.equal(hydrateLibraryMetadata([], [freesound.sounds[0]]).sounds[0].favorite, true);
assert.equal(loadFavoriteCollections()[0].id, "old");
assert.ok(nativeMetadata.sounds["source:scorpion:987"]);
assert.ok(nativeMetadata.sounds["source:freesound:7"]);
assert.equal(nativeMetadata.sounds["scorpion:987"], undefined);
assert.equal(hydrateLibraryMetadata([], [local]).sounds[0].waveformReal, true);
assert.equal(hydrateLibraryMetadata([], [local]).sounds[0].favorite, false, "Portable edits take precedence");
await loadPortableLibraryMetadata();
assert.equal(hydrateLibraryMetadata([], [local]).sounds[0].waveformReal, true, "Foreground refresh must retain local waveforms");
saveSoundMetadata(cloud[0], { favorite: false });
flushLibraryMetadata();
await Promise.resolve();
await loadPortableLibraryMetadata();
assert.equal(hydrateLibraryMetadata([], [cloud[0]]).sounds[0].favorite, false, "Migration must not resurrect removed favorites");
assert.ok(records.has(legacyKey), "Legacy metadata must remain untouched");
const macSound = { ...local, path: "/Volumes/SFX/Cafe\u0301/Hit.wav" };
saveSoundMetadata(macSound, { favorite: true });
assert.equal(hydrateLibraryMetadata([], [{ ...macSound, path: "/Volumes/SFX/Café/Hit.wav" }]).sounds[0].favorite, true, "Composed/decomposed Mac names must share metadata");
assert.notEqual(hydrateLibraryMetadata([], [{ ...macSound, path: "/Volumes/SFX/Café/hit.wav" }]).sounds[0].favorite, true, "Distinct case-sensitive Mac files must not share favorites");
console.log("Resolve parity smoke passed: audio, SFX timing/gain/channels, progress, pin, updates, legacy memories, waveforms, and 0 dB settings.");
