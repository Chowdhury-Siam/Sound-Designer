import { ContractError } from "../../shared/contracts";

const FREESOUND_HOSTS = new Set(["freesound.org", "www.freesound.org", "cdn.freesound.org"]);
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_AUDIO_BYTES = 128 * 1024 * 1024;

const trustedUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ContractError("INVALID_FREESOUND_URL", "The Freesound URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || !FREESOUND_HOSTS.has(url.hostname)) {
    throw new ContractError("INVALID_FREESOUND_URL", "The remote audio source is not trusted.");
  }
  return url;
};

export const validateFreesoundSearchUrl = (value: string): string => {
  const url = trustedUrl(value);
  if ((url.hostname !== "freesound.org" && url.hostname !== "www.freesound.org") || url.pathname !== "/apiv2/search/") {
    throw new ContractError("INVALID_FREESOUND_URL", "Only the Freesound search API can be queried.");
  }
  url.searchParams.delete("token");
  return url.toString();
};

export const validateFreesoundAudioUrl = (value: string): string => trustedUrl(value).toString();

export const extensionFromFreesoundUrl = (value: string): string => {
  const extension = new URL(validateFreesoundAudioUrl(value)).pathname.split(".").pop()?.toLowerCase() || "mp3";
  return new Set(["aac", "aif", "aiff", "flac", "m4a", "mp3", "ogg", "opus", "wav"]).has(extension)
    ? extension
    : "mp3";
};

const responseBytes = async (response: Response, limit: number): Promise<Uint8Array> => {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > limit) throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "Freesound returned more data than SoundDesigner can safely process.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > limit) {
    throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "Freesound returned an empty or oversized response.");
  }
  return bytes;
};

const assertResponse = (response: Response, action: string): void => {
  if (response.status === 401 || response.status === 403) {
    throw new ContractError("FREESOUND_AUTH_FAILED", "The Freesound API key is invalid. Update it in Settings.");
  }
  if (response.status === 429) {
    throw new ContractError("FREESOUND_RATE_LIMITED", "Freesound request limit reached. Please try again later.");
  }
  if (!response.ok) throw new ContractError("FREESOUND_REQUEST_FAILED", `${action} failed (HTTP ${response.status}).`);
};

export const searchFreesoundApi = async (url: string, apiKey: string, signal: AbortSignal): Promise<unknown> => {
  const response = await fetch(validateFreesoundSearchUrl(url), {
    headers: { Accept: "application/json", Authorization: `Token ${apiKey}` },
    signal,
  });
  assertResponse(response, "Freesound search");
  const bytes = await responseBytes(response, MAX_JSON_BYTES);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ContractError("FREESOUND_INVALID_RESPONSE", "Freesound returned an invalid search response.");
  }
};

export const downloadFreesoundAudio = async (
  url: string,
  signal: AbortSignal,
  onProgress: (receivedBytes: number, totalBytes?: number) => void,
  maximumBytes = MAX_AUDIO_BYTES,
): Promise<Uint8Array> => {
  const response = await fetch(validateFreesoundAudioUrl(url), { headers: { Accept: "audio/*" }, signal });
  assertResponse(response, "Freesound download");
  const total = Number(response.headers.get("content-length") || 0) || undefined;
  if (total && total > maximumBytes) {
    throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "This Freesound preview is too large to process safely.");
  }
  if (!response.body) return responseBytes(response, maximumBytes);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumBytes) {
      await reader.cancel();
      throw new ContractError("REMOTE_RESPONSE_TOO_LARGE", "This Freesound preview is too large to process safely.");
    }
    chunks.push(value);
    onProgress(received, total);
  }
  if (!received) throw new ContractError("FREESOUND_EMPTY_AUDIO", "Freesound returned an empty audio preview.");
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  onProgress(received, total || received);
  return bytes;
};
