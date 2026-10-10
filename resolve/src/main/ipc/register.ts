import path from "node:path";
import * as fs from "node:fs";
import { FreesoundCredentialStore } from "../../../../src/js/platform/credentials";
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { ContractError, parseDragPath, parseExternalUrl, parseImportAudioRequest, parseInsertAudioRequest, parsePortableLibraryMetadata, parsePortablePreferences, parseResolveSfxAnalysisRequest, parseResolveSfxPlacementRequest } from "../../shared/contracts";
import { PLUGIN_VERSION, type BridgeResult, type CloudSfxMediaRequest, type CloudSfxSearchItem, type CloudSfxSearchRequest, type FreesoundDownloadRequest, type FreesoundPreviewRequest, type FreesoundSearchRequest, type GithubReleaseResponse, type LibraryLabelColor, type LibrarySnapshot, type PortableLibraryMetadata, type PortablePreferences, type PreparedAudioFile, type PreparedAudioWriteRequest, type RemoteAudioProgress, type ResolveContext, type SelectedAudioFile, type StorageInfo } from "../../shared/types";
import type { ResolveHostAdapter } from "../services/resolveHost";
import { ResolveHostError } from "../services/resolveHost";
import type { LibraryService } from "../services/libraryService";
import { startNativeDrag } from "../services/nativeDrag";
import { ProjectStorage } from "../services/projectStorage";
import type { StorageService } from "../services/storageService";
import { downloadFreesoundAudio, extensionFromFreesoundUrl, searchFreesoundApi, validateFreesoundAudioUrl, validateFreesoundSearchUrl } from "../services/freesoundService";
import { downloadCloudSfxAudio, searchCloudSfx } from "../services/cloudSfxService";
import { isTrustedUiSender } from "../uiProtocol";
import { AUDIO_INPUT_EXTENSIONS } from "../../shared/audioFormats";

type HostFactory = () => ResolveHostAdapter;
type LibraryFactory = () => LibraryService;
type StorageFactory = () => StorageService;

const publicError = (error: unknown): { code: string; message: string } => {
  if (error instanceof ContractError || error instanceof ResolveHostError) {
    return { code: error.code, message: error.message };
  }
  console.error("SoundDesigner operation failed", error);
  return { code: "UNEXPECTED_ERROR", message: "SoundDesigner could not complete the operation." };
};

const safe = async <T>(operation: () => Promise<T>): Promise<BridgeResult<T>> => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: publicError(error) };
  }
};

const requireId = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 256) {
    throw new ContractError("INVALID_LIBRARY_REQUEST", `${label} is invalid.`);
  }
  return value;
};

const AUDIO_EXTENSIONS = new Set(["aac", "aif", "aiff", "caf", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]);
const LABEL_COLORS = new Set<LibraryLabelColor>(["red", "orange", "yellow", "green", "blue", "purple", "gray"]);
const MAX_AUDIO_BYTES = 512 * 1024 * 1024;
const cloudOperations = new Map<string, AbortController>();

const requireAudioPath = (value: unknown): string => {
  const filePath = parseDragPath(value);
  if (!path.isAbsolute(filePath) || !AUDIO_INPUT_EXTENSIONS.has(path.extname(filePath).slice(1).toLowerCase())) {
    throw new ContractError("INVALID_AUDIO_PATH", "The selected path is not a supported absolute audio-file path.");
  }
  return filePath;
};

const requireDirectoryPath = (value: unknown): string => {
  const directoryPath = parseDragPath(value);
  if (!path.isAbsolute(directoryPath)) throw new ContractError("INVALID_LIBRARY_REQUEST", "The library folder path is invalid.");
  return directoryPath;
};

const optionalLabel = (value: unknown): LibraryLabelColor | undefined => {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !LABEL_COLORS.has(value as LibraryLabelColor)) {
    throw new ContractError("INVALID_LIBRARY_REQUEST", "The label color is invalid.");
  }
  return value as LibraryLabelColor;
};

const preparedRequest = (value: unknown): PreparedAudioWriteRequest => {
  if (!value || typeof value !== "object") throw new ContractError("INVALID_AUDIO_REQUEST", "Prepared-audio request is invalid.");
  const request = value as Partial<PreparedAudioWriteRequest>;
  const kinds = new Set(["downloads", "converted", "processed", "segments"]);
  if (!request.kind || !kinds.has(request.kind)) throw new ContractError("INVALID_AUDIO_REQUEST", "Prepared-audio destination is invalid.");
  const bytes = request.bytes instanceof Uint8Array ? request.bytes : null;
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_AUDIO_BYTES) {
    throw new ContractError("INVALID_AUDIO_REQUEST", "Prepared audio is empty or exceeds the 512 MB limit.");
  }
  let metadata: Record<string, unknown> | undefined;
  if (request.metadata !== undefined) {
    if (!request.metadata || typeof request.metadata !== "object" || Array.isArray(request.metadata)) {
      throw new ContractError("INVALID_AUDIO_REQUEST", "Prepared-audio metadata is invalid.");
    }
    const serialized = JSON.stringify(request.metadata);
    if (serialized.length > 64 * 1024) throw new ContractError("INVALID_AUDIO_REQUEST", "Prepared-audio metadata is too large.");
    metadata = JSON.parse(serialized) as Record<string, unknown>;
  }
  return {
    sourceId: requireId(request.sourceId, "Source ID"),
    displayName: requireId(request.displayName, "Display name"),
    kind: request.kind,
    bytes,
    projectId: requireId(request.projectId, "Project ID"),
    metadata,
  };
};

const safeFileName = (value: string): string => value
  .normalize("NFC")
  .replace(/[<>:"/\\|?*\x00-\x1f]+/g, "-")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, 140) || "sound";

const stableId = (value: string): string => createHash("sha1").update(value).digest("hex").slice(0, 16);

const writeAtomically = async (outputPath: string, bytes: Uint8Array): Promise<void> => {
  const temporaryPath = `${outputPath}.${randomUUID()}.part`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
};

const writeMetadata = async (metadataDirectory: string, outputPath: string, value: Record<string, unknown>): Promise<void> => {
  const metadataPath = path.join(metadataDirectory, `${path.basename(outputPath, path.extname(outputPath))}.json`);
  await writeAtomically(metadataPath, new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`));
};

const requireOperationId = (value: unknown): string => requireId(value, "Operation ID");

const freesoundSearchRequest = (value: unknown): FreesoundSearchRequest => {
  if (!value || typeof value !== "object") throw new ContractError("INVALID_FREESOUND_REQUEST", "Freesound search request is invalid.");
  const request = value as Partial<FreesoundSearchRequest>;
  const apiKey = typeof request.apiKey === "string" ? request.apiKey.trim() : "";
  if (!apiKey || apiKey.length > 512) throw new ContractError("INVALID_FREESOUND_REQUEST", "The Freesound API key is invalid.");
  const url = typeof request.url === "string" ? validateFreesoundSearchUrl(request.url) : "";
  return { operationId: requireOperationId(request.operationId), url, apiKey };
};

const freesoundDownloadRequest = (value: unknown): FreesoundDownloadRequest => {
  if (!value || typeof value !== "object") throw new ContractError("INVALID_FREESOUND_REQUEST", "Freesound download request is invalid.");
  const request = value as Partial<FreesoundDownloadRequest>;
  const url = typeof request.url === "string" ? validateFreesoundAudioUrl(request.url) : "";
  return {
    operationId: requireOperationId(request.operationId),
    url,
    sourceId: requireId(request.sourceId, "Source ID"),
    displayName: requireId(request.displayName, "Display name"),
    creator: request.creator === undefined ? undefined : requireId(request.creator, "Creator"),
    license: request.license === undefined ? undefined : requireId(request.license, "License"),
    sourceUrl: request.sourceUrl === undefined ? undefined : validateFreesoundAudioUrl(request.sourceUrl),
  };
};

const freesoundPreviewRequest = (value: unknown): FreesoundPreviewRequest => {
  if (!value || typeof value !== "object") throw new ContractError("INVALID_FREESOUND_REQUEST", "Freesound preview request is invalid.");
  const request = value as Partial<FreesoundPreviewRequest>;
  return {
    operationId: requireOperationId(request.operationId),
    url: typeof request.url === "string" ? validateFreesoundAudioUrl(request.url) : "",
  };
};

const cloudSfxSearchRequest = (value: unknown): CloudSfxSearchRequest => {
  if (!value || typeof value !== "object") throw new ContractError("INVALID_CLOUD_SFX_REQUEST", "Cloud SFX search request is invalid.");
  const request = value as Partial<CloudSfxSearchRequest>;
  const query = typeof request.query === "string" ? request.query.trim() : "";
  if (query.length < 2 || query.length > 200) throw new ContractError("INVALID_CLOUD_SFX_REQUEST", "Cloud SFX searches require 2 to 200 characters.");
  return { operationId: requireOperationId(request.operationId), query };
};

const cloudSfxMediaRequest = (value: unknown, displayName = false): CloudSfxMediaRequest => {
  if (!value || typeof value !== "object") throw new ContractError("INVALID_CLOUD_SFX_REQUEST", "Cloud SFX media request is invalid.");
  const request = value as Partial<CloudSfxMediaRequest>;
  const id = requireId(request.sourceId, "Cloud SFX item ID");
  if (!/^[1-9]\d{0,15}$/.test(id)) throw new ContractError("INVALID_CLOUD_SFX_REQUEST", "The Cloud SFX item ID is invalid.");
  return {
    operationId: requireOperationId(request.operationId),
    sourceId: id,
    displayName: displayName ? requireId(request.displayName, "Display name") : undefined,
  };
};

const withCloudOperation = async <T>(operationId: string, timeoutMs: number, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  if (cloudOperations.has(operationId)) throw new ContractError("DUPLICATE_OPERATION", "This remote operation is already running.");
  const controller = new AbortController();
  cloudOperations.set(operationId, controller);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) throw new ContractError("REMOTE_OPERATION_CANCELLED", "The remote operation was cancelled or timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
    cloudOperations.delete(operationId);
  }
};

export const registerIpcHandlers = (getHost: HostFactory, getLibrary: LibraryFactory, getStorage: StorageFactory): void => {
  const handle = (channel: string, listener: (event: any, ...args: any[]) => unknown): void => {
    ipcMain.handle(channel, (event: any, ...args: unknown[]) => {
      if (!isTrustedUiSender(event)) return { ok: false, error: { code: "UNTRUSTED_SENDER", message: "Only the SoundDesigner window can perform this operation." } };
      return listener(event, ...args);
    });
  };
  const credentials = new FreesoundCredentialStore(fs, path.join(app.getPath("appData"), "SoundDesigner"));
  handle("storage:get-freesound-api-key", (_event: unknown, legacyKey: unknown) => safe(async () => credentials.get(legacyKey)));
  handle("storage:save-freesound-api-key", (_event: unknown, value: unknown) => safe(async () => {
    await credentials.save(value);
    return { saved: true as const };
  }));
  handle("runtime:set-always-on-top", (event: any, value: unknown) => safe(async () => {
    if (typeof value !== "boolean") throw new ContractError("INVALID_ARGUMENT", "Always-on-top state must be a boolean.");
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new ResolveHostError("WINDOW_UNAVAILABLE", "The SoundDesigner window is unavailable.");
    window.setAlwaysOnTop(value);
    return { alwaysOnTop: window.isAlwaysOnTop() };
  }));
  handle("runtime:open-external", (_event: unknown, value: unknown) => safe(async () => {
    await shell.openExternal(parseExternalUrl(value));
    return { opened: true as const };
  }));
  handle("runtime:get-latest-release", (_event: unknown, value: unknown) => safe<GithubReleaseResponse>(async () => {
    const etag = value === undefined ? undefined : requireId(value, "Update ETag");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "User-Agent": `SoundDesigner-Resolve/${PLUGIN_VERSION}`,
        "X-GitHub-Api-Version": "2022-11-28",
      };
      if (etag) headers["If-None-Match"] = etag;
      const response = await fetch("https://api.github.com/repos/iboyshanto/SoundDesigner/releases/latest", { headers, signal: controller.signal });
      if (response.status === 304) return { notModified: true, etag: response.headers.get("etag") || etag };
      if (response.status === 404) throw new ContractError("UPDATE_NOT_PUBLISHED", "No public SoundDesigner for Resolve release was found yet.");
      if (response.status === 403 || response.status === 429) throw new ContractError("UPDATE_RATE_LIMITED", "GitHub temporarily limited update checks. Try again later.");
      if (!response.ok) throw new ContractError("UPDATE_CHECK_FAILED", `GitHub update check failed (HTTP ${response.status}).`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength || bytes.byteLength > 1024 * 1024) throw new ContractError("UPDATE_INVALID_RESPONSE", "GitHub returned an invalid update response.");
      return {
        notModified: false,
        etag: response.headers.get("etag") || undefined,
        release: JSON.parse(new TextDecoder().decode(bytes)),
      };
    } catch (error) {
      if (controller.signal.aborted) throw new ContractError("UPDATE_TIMEOUT", "The GitHub update check timed out.");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }));
  handle("storage:get-info", () => safe<StorageInfo>(async () => getStorage().info));
  handle("storage:get-preferences", () => safe<PortablePreferences | null>(async () =>
    (await getStorage().readPreferences<PortablePreferences>()) ?? null));
  handle("storage:save-preferences", (_event: unknown, value: unknown) => safe(async () => {
    await getStorage().writePreferences(parsePortablePreferences(value));
    return { saved: true as const };
  }));
  handle("storage:get-library-metadata", () => safe<PortableLibraryMetadata | null>(async () =>
    (await getStorage().readLibraryMetadata<PortableLibraryMetadata>()) ?? null));
  handle("storage:save-library-metadata", (_event: unknown, value: unknown) => safe(async () => {
    await getStorage().writeLibraryMetadata(parsePortableLibraryMetadata(value));
    return { saved: true as const };
  }));
  handle("storage:change-location", () => safe<StorageInfo | null>(async () => {
    const selection = await dialog.showOpenDialog({
      title: "Choose SoundDesigner storage folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    const selectedPath = selection.canceled ? undefined : selection.filePaths[0];
    if (!selectedPath) return null;
    const existing = await getStorage().hasManifest(selectedPath);
    const confirmation = await dialog.showMessageBox({
      type: "question",
      title: "Change central audio folder?",
      message: "Save new audio in this SoundDesigner folder?",
      detail: "Existing files stay in their current location. Settings and library records stay on this computer.",
      buttons: [existing ? "Use existing folder" : "Use folder", "Cancel"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (confirmation.response !== 0) return null;
    return getStorage().changeRoot(selectedPath);
  }));
  handle("resolve:get-context", () => safe<ResolveContext>(() => getHost().getProjectContext()));
  handle("resolve:ensure-bin", () => safe(() => getHost().ensureSoundDesignerBin()));
  handle("resolve:import-audio", (_event: unknown, value: unknown) =>
    safe(() => getHost().importPreparedAudio(parseImportAudioRequest(value))));
  handle("resolve:insert-audio", (_event: unknown, value: unknown) =>
    safe(() => getHost().insertAtPlayhead(parseInsertAudioRequest(value))));
  handle("resolve:analyze-sfx", (_event: unknown, value: unknown) => safe(() => {
    const request = parseResolveSfxAnalysisRequest(value);
    return getHost().analyzeSfx(request.scope, request.density);
  }));
  handle("resolve:place-sfx", (_event: unknown, value: unknown) =>
    safe(() => getHost().placeSfx(parseResolveSfxPlacementRequest(value))));
  handle("audio:choose-wav", () => safe<SelectedAudioFile | null>(async () => {
    const selection = await dialog.showOpenDialog({
      title: "Select a WAV for the Resolve feasibility test",
      buttonLabel: "Select WAV",
      properties: ["openFile"],
      filters: [{ name: "Wave audio", extensions: ["wav"] }],
    });
    const selectedPath = selection.canceled ? undefined : selection.filePaths[0];
    return selectedPath ? { path: selectedPath, name: path.basename(selectedPath) } : null;
  }));
  ipcMain.on("audio:start-drag", async (event: any, value: unknown) => {
    try {
      if (!isTrustedUiSender(event)) throw new ContractError("UNTRUSTED_SENDER", "Only the SoundDesigner window can start a drag.");
      const request = parseImportAudioRequest(value);
      await getHost().importPreparedAudio(request, true);
      startNativeDrag(event.sender, request.path);
    } catch (error) {
      if (!event.sender.isDestroyed()) event.sender.send("audio:drag-error", publicError(error));
    }
  });
  handle("audio:read-file", (_event: unknown, value: unknown) => safe<Uint8Array>(async () => {
    const filePath = requireAudioPath(value);
    const details = await stat(filePath);
    if (!details.isFile() || details.size > MAX_AUDIO_BYTES) throw new ContractError("AUDIO_TOO_LARGE", "The audio file is unavailable or exceeds the 512 MB limit.");
    return new Uint8Array(await readFile(filePath));
  }));
  handle("audio:write-prepared", (_event: unknown, value: unknown) => safe<PreparedAudioFile>(async () => {
    const request = preparedRequest(value);
    const context = await getHost().getProjectContext();
    if (context.projectId !== request.projectId) throw new ResolveHostError("CONTEXT_CHANGED", "The active Resolve project changed before audio preparation completed.");
    const locations = await new ProjectStorage(getStorage().root).ensure(context);
    const extension = request.kind === "downloads"
      ? (path.extname(request.displayName).slice(1).toLowerCase() || "wav")
      : "wav";
    if (!AUDIO_EXTENSIONS.has(extension)) throw new ContractError("INVALID_AUDIO_REQUEST", "The prepared audio extension is unsupported.");
    const stem = safeFileName(path.basename(request.displayName, path.extname(request.displayName)));
    const id = stableId(request.sourceId);
    const outputPath = path.join(locations[request.kind], `${id}-${stem}.${extension}`);
    const existing = await stat(outputPath).catch(() => null);
    if (!existing?.isFile() || existing.size < 1) await writeAtomically(outputPath, request.bytes);
    if (request.metadata) {
      await writeMetadata(locations.metadata, outputPath, {
        ...request.metadata,
        version: 1,
        kind: request.kind,
        sourceId: request.sourceId,
        displayName: request.displayName,
        outputPath,
        createdAt: new Date().toISOString(),
      });
    }
    const details = await stat(outputPath);
    const current = await getHost().getProjectContext();
    if (current.projectId !== context.projectId) throw new ResolveHostError("CONTEXT_CHANGED", "The active Resolve project changed while audio was being prepared.");
    return { path: outputPath, projectRoot: locations.root, size: details.size, modifiedAt: details.mtimeMs };
  }));
  handle("cloud:freesound-search", (_event: unknown, value: unknown) => safe<unknown>(async () => {
    const request = freesoundSearchRequest(value);
    return withCloudOperation(request.operationId, 30_000, (signal) => searchFreesoundApi(request.url, request.apiKey, signal));
  }));
  handle("cloud:freesound-download", (event: any, value: unknown) => safe<PreparedAudioFile>(async () => {
    const request = freesoundDownloadRequest(value);
    const context = await getHost().getProjectContext();
    const locations = await new ProjectStorage(getStorage().root).ensure(context);
    const extension = extensionFromFreesoundUrl(request.url);
    const stem = safeFileName(path.basename(request.displayName, path.extname(request.displayName)));
    const id = stableId(`${request.sourceId}|${request.url}`);
    const outputPath = path.join(locations.downloads, `${id}-${stem}.${extension}`);
    const metadata = {
      version: 1,
      kind: "freesound-download",
      provider: "Freesound",
      id: request.sourceId,
      name: request.displayName,
      creator: request.creator || "",
      license: request.license || "",
      sourceUrl: request.sourceUrl || "",
      previewUrl: request.url,
      localSource: outputPath,
      downloadedAt: new Date().toISOString(),
    };
    const cached = await stat(outputPath).catch(() => null);
    if (cached?.isFile() && cached.size > 0) {
      await writeMetadata(locations.metadata, outputPath, metadata);
      return { path: outputPath, projectRoot: locations.root, size: cached.size, modifiedAt: cached.mtimeMs };
    }

    return withCloudOperation(request.operationId, 120_000, async (signal) => {
      const bytes = await downloadFreesoundAudio(request.url, signal, (receivedBytes, totalBytes) => {
        const progress: RemoteAudioProgress = {
          operationId: request.operationId,
          receivedBytes,
          totalBytes,
          progress: totalBytes ? Math.min(1, receivedBytes / totalBytes) : undefined,
        };
        if (!event.sender.isDestroyed()) event.sender.send("cloud:download-progress", progress);
      });
      await writeAtomically(outputPath, bytes);
      await writeMetadata(locations.metadata, outputPath, metadata);
      const details = await stat(outputPath);
      return { path: outputPath, projectRoot: locations.root, size: details.size, modifiedAt: details.mtimeMs };
    });
  }));
  handle("cloud:freesound-preview", (_event: unknown, value: unknown) => safe<Uint8Array>(async () => {
    const request = freesoundPreviewRequest(value);
    return withCloudOperation(request.operationId, 60_000, (signal) =>
      downloadFreesoundAudio(request.url, signal, () => undefined, 32 * 1024 * 1024));
  }));
  handle("cloud:sfx-search", (_event: unknown, value: unknown) => safe<CloudSfxSearchItem[]>(async () => {
    const request = cloudSfxSearchRequest(value);
    return withCloudOperation(request.operationId, 12_000, (signal) => searchCloudSfx(request.query, signal));
  }));
  handle("cloud:sfx-preview", (_event: unknown, value: unknown) => safe<Uint8Array>(async () => {
    const request = cloudSfxMediaRequest(value);
    return withCloudOperation(request.operationId, 12_000, (signal) => downloadCloudSfxAudio(request.sourceId, "preview", signal, 32 * 1024 * 1024));
  }));
  handle("cloud:sfx-download", (_event: unknown, value: unknown) => safe<PreparedAudioFile>(async () => {
    const request = cloudSfxMediaRequest(value, true);
    const context = await getHost().getProjectContext();
    const locations = await new ProjectStorage(getStorage().root).ensure(context);
    const stem = safeFileName(path.basename(request.displayName || "Cloud SFX", path.extname(request.displayName || "")));
    const outputPath = path.join(locations.downloads, `${stableId(`cloud-sfx:${request.sourceId}`)}-${stem}.mp3`);
    const metadata = {
      version: 1, kind: "cloud-sfx-download", provider: "Cloud SFX", id: request.sourceId,
      name: request.displayName, sourceUrl: "https://aiscorpionsfx.com", localSource: outputPath,
      downloadedAt: new Date().toISOString(),
    };
    const cached = await stat(outputPath).catch(() => null);
    if (cached?.isFile() && cached.size > 0) {
      await writeMetadata(locations.metadata, outputPath, metadata);
      return { path: outputPath, projectRoot: locations.root, size: cached.size, modifiedAt: cached.mtimeMs };
    }
    return withCloudOperation(request.operationId, 12_000, async (signal) => {
      const bytes = await downloadCloudSfxAudio(request.sourceId, "download", signal);
      await writeAtomically(outputPath, bytes);
      await writeMetadata(locations.metadata, outputPath, metadata);
      const details = await stat(outputPath);
      return { path: outputPath, projectRoot: locations.root, size: details.size, modifiedAt: details.mtimeMs };
    });
  }));
  handle("cloud:cancel", (_event: unknown, value: unknown) => safe(async () => {
    const operationId = requireOperationId(value);
    const controller = cloudOperations.get(operationId);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  }));
  handle("library:get-snapshot", () => safe<LibrarySnapshot>(() => getLibrary().getSnapshot()));
  handle("library:add-folder", (event: any) => safe<LibrarySnapshot | null>(async () => {
    const selection = await dialog.showOpenDialog({
      title: "Add sound library",
      buttonLabel: "Add folder",
      properties: ["openDirectory"],
    });
    const selectedPath = selection.canceled ? undefined : selection.filePaths[0];
    if (!selectedPath) return null;
    return getLibrary().addFolder(selectedPath, (progress) => event.sender.send("library:scan-progress", progress));
  }));
  handle("library:choose-folder", () => safe<string | null>(async () => {
    const selection = await dialog.showOpenDialog({
      title: "Add sound library",
      buttonLabel: "Add folder",
      properties: ["openDirectory"],
    });
    return selection.canceled ? null : selection.filePaths[0] || null;
  }));
  handle("library:scan-folder", (event: any, value: unknown) => safe<LibrarySnapshot>(() =>
    getLibrary().addFolder(requireDirectoryPath(value),
      (progress) => event.sender.send("library:scan-progress", progress))));
  handle("library:rescan", (event: any, value: unknown) => safe<LibrarySnapshot>(() =>
    getLibrary().rescan(value === undefined ? undefined : requireId(value, "Folder ID"),
      (progress) => event.sender.send("library:scan-progress", progress))));
  handle("library:remove-folder", (_event: unknown, value: unknown) =>
    safe<LibrarySnapshot>(() => getLibrary().removeFolder(requireId(value, "Folder ID"))));
  handle("library:cancel-scan", () => safe(async () => ({ cancelled: getLibrary().cancelScan() })));
  handle("library:set-sound-favorite", (_event: unknown, value: unknown) => safe<LibrarySnapshot>(() => {
    if (!value || typeof value !== "object") throw new ContractError("INVALID_LIBRARY_REQUEST", "Favorite request is invalid.");
    const request = value as { soundId?: unknown; favorite?: unknown };
    if (typeof request.favorite !== "boolean") throw new ContractError("INVALID_LIBRARY_REQUEST", "Favorite value is invalid.");
    return getLibrary().setSoundFavorite(requireId(request.soundId, "Sound ID"), request.favorite);
  }));
  handle("library:set-folder-pinned", (_event: unknown, value: unknown) => safe<LibrarySnapshot>(() => {
    if (!value || typeof value !== "object") throw new ContractError("INVALID_LIBRARY_REQUEST", "Pinned-folder request is invalid.");
    const request = value as { nodeId?: unknown; pinned?: unknown };
    if (typeof request.pinned !== "boolean") throw new ContractError("INVALID_LIBRARY_REQUEST", "Pinned value is invalid.");
    return getLibrary().setFolderPinned(requireId(request.nodeId, "Folder node ID"), request.pinned);
  }));
  handle("library:set-sound-label", (_event: unknown, value: unknown) => safe<LibrarySnapshot>(() => {
    if (!value || typeof value !== "object") throw new ContractError("INVALID_LIBRARY_REQUEST", "Sound-label request is invalid.");
    const request = value as { soundId?: unknown; labelColor?: unknown };
    return getLibrary().setSoundLabel(requireId(request.soundId, "Sound ID"), optionalLabel(request.labelColor));
  }));
  handle("library:set-folder-label", (_event: unknown, value: unknown) => safe<LibrarySnapshot>(() => {
    if (!value || typeof value !== "object") throw new ContractError("INVALID_LIBRARY_REQUEST", "Folder-label request is invalid.");
    const request = value as { nodeId?: unknown; labelColor?: unknown };
    return getLibrary().setFolderLabel(requireId(request.nodeId, "Folder node ID"), optionalLabel(request.labelColor));
  }));
};
