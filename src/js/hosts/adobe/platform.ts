import { csi, evalTS, initBolt, openLinkInBrowser } from "../../lib/utils/bolt";
import { fs, path } from "../../lib/cep/node";
import { FreesoundCredentialStore } from "../../platform/credentials";
import { chooseLibraryFolder } from "../../main/library";
import type { HostApp, HostProjectContext, HostResult, InsertAudioRequest } from "../../main/types";
import type { SfxAnalysis, SfxDensity, SfxPlacement, SfxPlacementResult, SfxScope } from "../../main/sfxAssistant";
import type { AfterEffectsAudioDragState, PlatformResult, SoundDesignerPlatform } from "../../platform/types";
import { AdobeLibraryService } from "./library";
import { AdobeStorageService } from "./storage";

const errorMessage = (error: unknown, fallback: string): string =>
  error && typeof error === "object" && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error || fallback);

const unsupported = async <T>(feature: string): Promise<PlatformResult<T>> => ({
  ok: false,
  error: { code: "UNSUPPORTED", message: `${feature} is provided by the shared Adobe feature module.` },
});

const detectAdobeHost = (): HostApp => {
  if (!window.cep) return "browser";
  const applicationId = String(csi.getApplicationID() || "").toUpperCase();
  if (applicationId.includes("PPRO")) return "premiere";
  if (applicationId.includes("AEFT")) return "aftereffects";
  return "unknown";
};

const getContext = async (): Promise<HostProjectContext> => {
  const host = detectAdobeHost();
  if (!window.cep || host === "browser") return { ok: false, host: "browser", message: "Project storage is available inside the installed Adobe panel." };
  try {
    return await evalTS("getProjectContext") as HostProjectContext;
  } catch (error) {
    return { ok: false, host, message: errorMessage(error, "The Adobe project location could not be read.") };
  }
};

const insertAudio = async (request: InsertAudioRequest): Promise<HostResult> => {
  if (!request.path) return { ok: false, message: "This sound has no local source file. Add or rescan its library folder." };
  if (!window.cep) return { ok: true, host: "browser", message: "Insert simulated in browser preview." };
  try {
    return await evalTS("insertAudioClip", request) as HostResult;
  } catch (error) {
    return { ok: false, message: errorMessage(error, "The host did not return a valid response.") };
  }
};

const organizeAudio = async (request: InsertAudioRequest): Promise<HostResult> => {
  if (!request.path || !window.cep) return { ok: false, host: "browser", message: "Host media organization is unavailable." };
  try {
    return await evalTS("organizeAudioMedia", request) as HostResult;
  } catch (error) {
    return { ok: false, message: errorMessage(error, "The host did not return a valid response.") };
  }
};

const getDragState = async (request: InsertAudioRequest): Promise<AfterEffectsAudioDragState> => {
  if (!window.cep || detectAdobeHost() !== "aftereffects") return { ok: false, host: "browser", layerCount: 0, message: "After Effects is not the active CEP host." };
  try {
    return await evalTS("getAudioDragState", request) as AfterEffectsAudioDragState;
  } catch (error) {
    return { ok: false, host: "aftereffects", layerCount: 0, message: errorMessage(error, "The active composition could not be inspected.") };
  }
};

const analyzeSfx = async (scope: SfxScope, density: SfxDensity): Promise<SfxAnalysis> => {
  if (detectAdobeHost() !== "aftereffects") return { ok: false, message: "SFX Assistant currently requires After Effects.", compositionId: 0, compositionName: "", frameDuration: 0, analyzedLayers: 0, moments: [] };
  try {
    return await evalTS("analyzeSfxMoments", { scope, density }) as SfxAnalysis;
  } catch (error) {
    return { ok: false, message: errorMessage(error, "SFX analysis failed."), compositionId: 0, compositionName: "", frameDuration: 0, analyzedLayers: 0, moments: [] };
  }
};

const placeSfx = async (compositionId: number, placements: SfxPlacement[]): Promise<SfxPlacementResult> => {
  if (detectAdobeHost() !== "aftereffects") return { ok: false, message: "SFX Assistant currently requires After Effects.", placed: 0 };
  try {
    return await evalTS("placeSfxMoments", { compositionId, placements }) as SfxPlacementResult;
  } catch (error) {
    return { ok: false, message: errorMessage(error, "SFX placement failed."), placed: 0 };
  }
};

export const createAdobePlatform = (): SoundDesignerPlatform => {
  const host = detectAdobeHost();
  const credentials = host === "browser" ? null : new FreesoundCredentialStore(fs, path.join(csi.getSystemPath("userData"), "SoundDesigner"));
  const storage = host === "browser" ? null : new AdobeStorageService(
    path.join(csi.getSystemPath("userData"), "SoundDesigner"),
    path.join(csi.getSystemPath("myDocuments"), "SoundDesigner"),
  );
  const library = storage ? new AdobeLibraryService(storage) : null;
  const storageResult = async <T>(operation: () => Promise<T>): Promise<PlatformResult<T>> => {
    try { return { ok: true, data: await operation() }; }
    catch (error) { return { ok: false, error: { code: error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "STORAGE_ERROR", message: errorMessage(error, "Storage operation failed.") } }; }
  };
  const readyStorage = async () => {
    if (!storage) throw new Error("Portable storage is available inside the installed Adobe panel.");
    try { return await storage.initialize(); } catch (error) {
      if (error && typeof error === "object" && "code" in error && (error as { code: unknown }).code === "STORAGE_NOT_CONFIGURED") throw error;
      throw error;
    }
  };
  return {
    mode: host === "browser" ? "browser" : "adobe",
    host,
    capabilities: {
      nativeStorage: host !== "browser",
      nativeLibrary: host !== "browser",
      nativeAudioPreparation: false,
      nativeProjectHandoff: host !== "browser",
      nativeDrag: host !== "browser",
      nativeCloud: false,
      nativeUpdates: false,
      nativeSfxAssistant: host === "aftereffects",
    },
    initialize: () => initBolt(),
    runtime: {
      openExternal: async (url) => { openLinkInBrowser(url); return { ok: true, data: { opened: true } }; },
      registerKeyEventsInterest: (events) => {
        if (window.cep) csi.registerKeyEventsInterest(JSON.stringify(events));
      },
    },
    storage: {
      getFreesoundApiKey: (legacyKey) => storageResult(async () => {
        if (!credentials) throw new Error("Shared credentials are available inside an installed host.");
        return credentials.get(legacyKey);
      }),
      saveFreesoundApiKey: (value) => storageResult(async () => {
        if (!credentials) throw new Error("Shared credentials are available inside an installed host.");
        await credentials.save(value);
        return { saved: true as const };
      }),
      getInfo: () => storageResult(async () => { await readyStorage(); return storage!.info; }),
      getPreferences: () => storageResult(async () => { await readyStorage(); return storage!.getPreferences(); }),
      savePreferences: (value) => storageResult(async () => { await readyStorage(); await storage!.savePreferences(value); return { saved: true as const }; }),
      getLibraryMetadata: () => storageResult(async () => { await readyStorage(); return storage!.getLibraryMetadata(); }),
      saveLibraryMetadata: (value) => storageResult(async () => { await readyStorage(); await storage!.saveLibraryMetadata(value); return { saved: true as const }; }),
      changeLocation: () => storageResult(async () => storage ? storage.changeLocation() : null),
      setAudioStorageMode: (mode) => storageResult(async () => { await readyStorage(); return storage!.setAudioStorageMode(mode); }),
      getProjectRoot: (project) => storageResult(async () => { await readyStorage(); return storage!.getProjectRoot(project); }),
    },
    library: {
      getSnapshot: () => storageResult(async () => { await readyStorage(); return library!.getSnapshot(); }),
      addFolder: () => storageResult(async () => { await readyStorage(); return library!.addFolder(); }),
      chooseFolder: () => storageResult(async () => { await readyStorage(); return chooseLibraryFolder(); }),
      rescan: (folderId) => storageResult(async () => { await readyStorage(); return library!.rescan(folderId); }),
      removeFolder: (folderId) => storageResult(async () => { await readyStorage(); return library!.removeFolder(folderId); }),
      setSoundFavorite: (soundId, favorite) => storageResult(async () => { await readyStorage(); return library!.setSoundFavorite(soundId, favorite); }),
      setFolderPinned: (nodeId, pinned) => storageResult(async () => { await readyStorage(); return library!.setFolderPinned(nodeId, pinned); }),
      setSoundLabel: (soundId, labelColor) => storageResult(async () => { await readyStorage(); return library!.setSoundLabel(soundId, labelColor); }),
      setFolderLabel: (nodeId, labelColor) => storageResult(async () => { await readyStorage(); return library!.setFolderLabel(nodeId, labelColor); }),
    },
    audio: { readFile: () => unsupported("Audio reads"), writePrepared: () => unsupported("Audio preparation"), startDrag: () => unsupported("Native drag"), onDragError: () => () => undefined },
    project: { getContext },
    handoff: { insertAudio, organizeAudio, getAfterEffectsDragState: getDragState },
    cloud: { searchFreesound: () => unsupported("Freesound search"), readFreesoundPreview: () => unsupported("Freesound preview"), downloadFreesound: () => unsupported("Freesound download"), cancel: () => unsupported("Cloud cancellation"), search: () => unsupported("Cloud search"), readPreview: () => unsupported("Cloud preview"), download: () => unsupported("Cloud download") },
    updates: { getLatestRelease: () => unsupported("Native updates") },
    sfx: { analyze: analyzeSfx, place: placeSfx },
  };
};
