import { https } from "../lib/cep/node";
import { platform } from "../platform/client";
import type { FreesoundSearchPage } from "./freesound";
import type { FreesoundLicenseFilter, SoundFile } from "./types";

export const CLOUD_ORIGIN = "https://aiscorpionsfx.com";
const cloudPreviewCache = new Map<string, string>();
export const isCloudSound = (sound: Pick<SoundFile, "source">) => sound.source === "scorpion" || sound.source === "freesound";
export const isLibraryMediaUrl = (value: string) => {
  try { const url = new URL(value); return url.origin === CLOUD_ORIGIN && url.pathname === "/download.php" && !!url.searchParams.get("id"); } catch { return false; }
};
export const loadCloudEnabled = () => { try { return localStorage.getItem("sounddesigner.cloud-enabled.v1") !== "false"; } catch { return true; } };
export const saveCloudEnabled = (enabled: boolean) => { try { localStorage.setItem("sounddesigner.cloud-enabled.v1", String(enabled)); } catch {} };

const errorMessage = (error: unknown) => error && typeof error === "object" && "message" in error
  ? String(error.message)
  : String(error || "Unknown network error");

const browserRequest = async (url: string, signal?: AbortSignal): Promise<unknown> => {
  if (typeof fetch !== "function") throw new Error("Browser networking is unavailable.");
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal, redirect: "error" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const limit = 2 * 1024 * 1024;
    if (Number(response.headers.get("content-length") || 0) > limit) {
      await response.body?.cancel();
      throw new Error("Cloud response is too large.");
    }
    let body = "";
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > limit) { await reader.cancel(); throw new Error("Cloud response is too large."); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } else body = await response.text();
    if (body.length > limit) throw new Error("Cloud response is too large.");
    try { return JSON.parse(body); } catch { throw new Error("Invalid JSON response"); }
  } catch (error) {
    if (controller.signal.aborted && !signal?.aborted) throw new Error("Request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
};

const nodeRequest = (url: string, signal?: AbortSignal): Promise<unknown> => new Promise((resolve, reject) => {
  if (!https || typeof https.get !== "function") {
    reject(new Error("CEP Node networking is unavailable."));
    return;
  }
  let settled = false;
  let req: ReturnType<typeof https.get> | null = null;
  const finish = (error?: Error, value?: unknown) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener("abort", abort);
    error ? reject(error) : resolve(value);
  };
  const abort = () => { finish(new DOMException("Search cancelled.", "AbortError")); req?.abort(); };
  // Native Node (including CEP) sends no User-Agent by default. The cloud
  // service rejects those requests with 403; Bun's default hid this in tests.
  req = https.get(url, { headers: { Accept: "application/json", "User-Agent": "SoundDesigner CEP" } }, response => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) { finish(new Error("Cloud response is too large.")); req?.abort(); }
    });
    response.on("error", error => finish(error));
    response.on("end", () => {
      if (response.statusCode !== 200) return finish(new Error(`HTTP ${response.statusCode}`));
      try { finish(undefined, JSON.parse(body)); } catch { finish(new Error("Invalid JSON response")); }
    });
  });
  req.on("error", error => finish(error));
  req.setTimeout(12000, () => { finish(new Error("Request timed out")); req?.abort(); });
  if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
});

const request = async (route: string, signal?: AbortSignal): Promise<unknown> => {
  const url = CLOUD_ORIGIN + route;
  let browserError: unknown = null;
  try {
    // CEF uses the host OS trust store, which is often newer than the Node
    // runtime bundled with older Adobe releases. The endpoint explicitly
    // allows cross-origin requests, so prefer this path on every host.
    return await browserRequest(url, signal);
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
    browserError = error;
  }
  if (!window.cep) throw new Error(`Cloud library request failed: ${errorMessage(browserError)}.`);
  try {
    return await nodeRequest(url, signal);
  } catch (nodeError) {
    if (signal?.aborted || (nodeError instanceof DOMException && nodeError.name === "AbortError")) throw nodeError;
    throw new Error(`Cloud connection failed (browser: ${errorMessage(browserError)}; CEP Node: ${errorMessage(nodeError)}).`);
  }
};

export const searchCloudLibrary = async (query: string, signal?: AbortSignal): Promise<SoundFile[]> => {
  let response: unknown;
  if (platform().capabilities.nativeCloud) {
    const operationId = globalThis.crypto.randomUUID();
    const cancel = () => { void platform().cloud.cancel(operationId); };
    if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await platform().cloud.search({ operationId, query: query.trim() });
      if (signal?.aborted) throw new DOMException("Search cancelled.", "AbortError");
      if (!result.ok) throw new Error(result.error.message);
      response = result.data;
    } finally { signal?.removeEventListener("abort", cancel); }
  } else response = await request(`/search.php?q=${encodeURIComponent(query.trim())}`, signal);
  if (!Array.isArray(response)) throw new Error("Cloud library returned invalid search results.");
  return response.slice(0, 2000).flatMap((item): SoundFile[] => {
    if (!item || !Number.isSafeInteger(Number(item.id)) || Number(item.id) < 1 || typeof item.name !== "string" || (!platform().capabilities.nativeCloud && typeof item.preview_key !== "string")) return [];
    return [{
      id: `scorpion-${item.id}`, source: "scorpion", sourceId: String(item.id),
      folderId: "scorpion", directoryId: "scorpion", name: item.name, path: "",
      extension: "mp3", size: 0, modifiedAt: 0, duration: 0,
      tags: item.name.toLowerCase().split(/\s+/).slice(0, 16),
      waveform: new Float32Array(72), accent: "graphite", downloadState: "remote",
      sourceUrl: CLOUD_ORIGIN,
    }];
  });
};

export const resolveCloudPreview = async (sound: SoundFile, signal?: AbortSignal) => {
  const cached = cloudPreviewCache.get(sound.sourceId || "");
  if (cached) return cached;
  if (platform().capabilities.nativeCloud) {
    const operationId = globalThis.crypto.randomUUID();
    const cancel = () => { void platform().cloud.cancel(operationId); };
    if (signal?.aborted) throw new DOMException("Preview cancelled.", "AbortError");
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await platform().cloud.readPreview({ operationId, sourceId: sound.sourceId || "" });
      if (signal?.aborted) throw new DOMException("Preview cancelled.", "AbortError");
      if (!result.ok) throw new Error(result.error.message);
      const url = URL.createObjectURL(new Blob([new Uint8Array(result.data)], { type: "audio/mpeg" }));
      if (sound.sourceId) cloudPreviewCache.set(sound.sourceId, url);
      return url;
    } finally { signal?.removeEventListener("abort", cancel); }
  }
  const response = await request(`/get_preview_url.php?id=${encodeURIComponent(sound.sourceId || "")}`, signal) as { preview_url?: unknown };
  if (typeof response.preview_url !== "string") throw new Error("This cloud preview is unavailable.");
  const url = new URL(response.preview_url);
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com") throw new Error("Cloud library returned an invalid preview reference.");
  const id = url.searchParams.get("id");
  if (!id || !/^[\w-]+$/.test(id)) throw new Error("Cloud library returned an invalid preview reference.");
  const previewUrl = `${CLOUD_ORIGIN}/download.php?id=${encodeURIComponent(id)}`;
  if (sound.sourceId) cloudPreviewCache.set(sound.sourceId, previewUrl);
  return previewUrl;
};

export const resolveCloudDownload = async (sound: SoundFile, signal?: AbortSignal) => {
  if (sound.source !== "scorpion") return sound.previewUrl || "";
  const response = await request(`/get_download_url.php?id=${encodeURIComponent(sound.sourceId || "")}`, signal) as { download_url?: unknown };
  if (typeof response.download_url !== "string") throw new Error("This cloud sound is unavailable for download.");
  const url = new URL(response.download_url);
  if (url.protocol !== "https:" || url.hostname !== "drive.google.com") throw new Error("Cloud library returned an invalid download reference.");
  const id = url.searchParams.get("id");
  if (!id || !/^[\w-]+$/.test(id)) throw new Error("Cloud library returned an invalid file reference.");
  return `${CLOUD_ORIGIN}/download.php?id=${encodeURIComponent(id)}`;
};

export const searchSoundSources = async (query: string, apiKey: string, filter: FreesoundLicenseFilter, page: number, cloudEnabled: boolean, freesoundEnabled: boolean, signal?: AbortSignal): Promise<FreesoundSearchPage> => {
  const jobs: Promise<FreesoundSearchPage>[] = [];
  if (cloudEnabled && page === 1) jobs.push(searchCloudLibrary(query, signal).then(sounds => ({ sounds, total: sounds.length, page, hasNext: false })));
  if (freesoundEnabled && apiKey.trim()) jobs.push(import("./freesound").then(({ searchFreesound }) => searchFreesound(query, apiKey, filter, page, signal)));
  const results = await Promise.all(jobs.map(job => job.then(value => ({ value, error: null })).catch(error => ({ value: null, error }))));
  const good = results.filter(result => result.value).map(result => result.value!);
  if (!good.length && results.length) throw results[0].error;
  // An empty successful provider must not disguise another provider's failure
  // as a successful search with no matches.
  const failed = results.find(result => result.error);
  if (failed && !good.some(result => result.sounds.length)) throw failed.error;
  return { sounds: good.flatMap(result => result.sounds), total: good.reduce((sum, result) => sum + result.total, 0), page, hasNext: good.some(result => result.hasNext) };
};
