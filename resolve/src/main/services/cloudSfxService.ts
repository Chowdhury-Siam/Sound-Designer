import { ContractError } from "../../shared/contracts";
import type { CloudSfxSearchItem } from "../../shared/types";

export const CLOUD_SFX_ORIGIN = "https://aiscorpionsfx.com";
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;

const sourceId = (value: string): string => {
  if (!/^[1-9]\d{0,15}$/.test(value)) throw new ContractError("INVALID_CLOUD_SFX_ID", "The Cloud SFX item ID is invalid.");
  return value;
};

export const validateCloudSfxUrl = (value: string, path: "/search.php" | "/get_preview_url.php" | "/get_download_url.php" | "/download.php"): string => {
  let url: URL;
  try { url = new URL(value); } catch { throw new ContractError("INVALID_CLOUD_SFX_URL", "The Cloud SFX URL is invalid."); }
  if (url.origin !== CLOUD_SFX_ORIGIN || url.pathname !== path || url.username || url.password || url.hash) {
    throw new ContractError("INVALID_CLOUD_SFX_URL", "The Cloud SFX endpoint is not trusted.");
  }
  if (path === "/search.php") {
    if ([...url.searchParams.keys()].some((key) => key !== "q") || !url.searchParams.get("q")?.trim()) {
      throw new ContractError("INVALID_CLOUD_SFX_URL", "The Cloud SFX search endpoint is invalid.");
    }
  } else if ([...url.searchParams.keys()].some((key) => key !== "id") || !url.searchParams.get("id")) {
    throw new ContractError("INVALID_CLOUD_SFX_URL", "The Cloud SFX media endpoint is invalid.");
  }
  if (path === "/get_preview_url.php" || path === "/get_download_url.php") sourceId(url.searchParams.get("id") || "");
  if (path === "/download.php" && !/^[\w-]+$/.test(url.searchParams.get("id") || "")) {
    throw new ContractError("INVALID_CLOUD_SFX_URL", "The Cloud SFX media endpoint is invalid.");
  }
  return url.toString();
};

export const driveReferenceId = (value: unknown): string => {
  if (typeof value !== "string") throw new ContractError("INVALID_CLOUD_SFX_RESPONSE", "Cloud SFX returned an invalid Drive reference.");
  let url: URL;
  try { url = new URL(value); } catch { throw new ContractError("INVALID_CLOUD_SFX_RESPONSE", "Cloud SFX returned an invalid Drive reference."); }
  const filePath = url.pathname.match(/^\/file\/d\/([\w-]+)(?:\/view)?\/?$/);
  const acceptedPath = url.pathname === "/uc" || url.pathname === "/open" || Boolean(filePath);
  const pathId = filePath?.[1];
  const id = url.searchParams.get("id") || pathId || "";
  const allowedParameters = filePath ? new Set<string>() : url.pathname === "/uc" ? new Set(["id", "export"]) : new Set(["id"]);
  if (url.origin !== "https://drive.google.com" || url.username || url.password || url.hash || !acceptedPath
    || [...url.searchParams.keys()].some((key) => !allowedParameters.has(key)) || id.length > 256 || !/^[\w-]+$/.test(id)) {
    throw new ContractError("INVALID_CLOUD_SFX_RESPONSE", "Cloud SFX returned an invalid Drive reference.");
  }
  return id;
};

const responseBytes = async (response: Response, limit: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "Cloud SFX returned more data than SoundDesigner can safely process.");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > limit) throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "Cloud SFX returned an empty or oversized response.");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "Cloud SFX returned more data than SoundDesigner can safely process.");
    }
    chunks.push(value);
  }
  if (!length) throw new ContractError("CLOUD_SFX_EMPTY_RESPONSE", "Cloud SFX returned an empty response.");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
};

const request = async (url: string, signal: AbortSignal, accept: string, limit: number): Promise<Uint8Array> => {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "SoundDesigner Resolve" },
    redirect: "error",
    signal,
  });
  if (!response.ok) throw new ContractError("CLOUD_SFX_REQUEST_FAILED", `Cloud SFX request failed (HTTP ${response.status}).`);
  return responseBytes(response, limit);
};

const requestJson = async (url: string, path: Parameters<typeof validateCloudSfxUrl>[1], signal: AbortSignal): Promise<unknown> => {
  const bytes = await request(validateCloudSfxUrl(url, path), signal, "application/json", MAX_JSON_BYTES);
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new ContractError("INVALID_CLOUD_SFX_RESPONSE", "Cloud SFX returned invalid JSON."); }
};

export const mapCloudSfxResponse = (value: unknown): CloudSfxSearchItem[] => Array.isArray(value)
  ? value.slice(0, 2000).flatMap((item): CloudSfxSearchItem[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const id = String(entry.id ?? "");
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    return /^[1-9]\d{0,15}$/.test(id) && name && name.length <= 512 && typeof entry.preview_key === "string"
      ? [{ id, name }]
      : [];
  })
  : (() => { throw new ContractError("INVALID_CLOUD_SFX_RESPONSE", "Cloud SFX returned invalid search results."); })();

export const searchCloudSfx = async (query: string, signal: AbortSignal): Promise<CloudSfxSearchItem[]> => {
  const url = new URL("/search.php", CLOUD_SFX_ORIGIN);
  url.searchParams.set("q", query);
  return mapCloudSfxResponse(await requestJson(url.toString(), "/search.php", signal));
};

const mediaUrl = async (id: string, kind: "preview" | "download", signal: AbortSignal): Promise<string> => {
  const path = kind === "preview" ? "/get_preview_url.php" : "/get_download_url.php";
  const url = new URL(path, CLOUD_SFX_ORIGIN);
  url.searchParams.set("id", sourceId(id));
  const response = await requestJson(url.toString(), path, signal);
  const field = kind === "preview" ? "preview_url" : "download_url";
  const driveId = driveReferenceId(response && typeof response === "object" ? (response as Record<string, unknown>)[field] : undefined);
  return validateCloudSfxUrl(`${CLOUD_SFX_ORIGIN}/download.php?id=${encodeURIComponent(driveId)}`, "/download.php");
};

export const downloadCloudSfxAudio = async (id: string, kind: "preview" | "download", signal: AbortSignal, maximumBytes = MAX_AUDIO_BYTES): Promise<Uint8Array> =>
  request(await mediaUrl(id, kind, signal), signal, "audio/*", maximumBytes);
