import { fs, https } from "../lib/cep/node";
import { encodeRenderedWave, renderAudioProcessing } from "./audioEffects";
import type { AudioProcessingSettings, AudioSegmentSelection, SoundFile } from "./types";

// Keep enough source detail for the 3x preview zoom while the renderer caps the
// number of SVG points it draws. This remains tiny compared with decoded audio:
// roughly 24 KB per channel rather than retaining full PCM sample buffers.
const PEAK_BINS = 1536;
const MAX_DECODE_BYTES = 32 * 1024 * 1024;
const MAX_DECODE_DURATION_SECONDS = 120;
const MAX_CACHE_ENTRIES = 8;
const MAX_PREVIEW_PCM_BYTES = 96 * 1024 * 1024;
const channelCache = new Map<string, Float32Array[]>();
let processedPreviewDecodeCache: { key: string; buffer: AudioBuffer } | null = null;
let processedPreviewDecodePending: { key: string; promise: Promise<AudioBuffer> } | null = null;
let processedPreviewEvictionTimer = 0;

const retainProcessedPreviewDecode = (key: string, buffer: AudioBuffer) => {
  processedPreviewDecodeCache = { key, buffer };
  if (processedPreviewEvictionTimer) window.clearTimeout(processedPreviewEvictionTimer);
  processedPreviewEvictionTimer = window.setTimeout(() => {
    if (processedPreviewDecodeCache?.key === key) processedPreviewDecodeCache = null;
    processedPreviewEvictionTimer = 0;
  }, 20_000);
};

const readAudioFile = (filePath: string) => new Promise<ArrayBuffer>((resolve, reject) => {
  fs.readFile(filePath, (error, bytes) => {
    if (error) {
      reject(error);
      return;
    }
    const source = bytes.buffer as ArrayBuffer;
    resolve(source.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  });
});

const trustedRemoteAudioUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && (parsed.hostname === "freesound.org" || parsed.hostname === "www.freesound.org" || parsed.hostname === "cdn.freesound.org");
  } catch (_error) {
    return false;
  }
};

const readRemoteAudioWithNode = (
  remoteUrl: string,
  shouldContinue?: () => boolean,
  redirectCount = 0,
): Promise<ArrayBuffer> => new Promise((resolve, reject) => {
  if (!https || typeof https.get !== "function") {
    reject(new Error("CEP HTTPS is unavailable."));
    return;
  }
  let settled = false;
  const finishError = (error: Error) => {
    if (settled) return;
    settled = true;
    reject(error);
  };
  const request = https.get(remoteUrl, { headers: { "User-Agent": "SoundDesigner CEP" } }, (response) => {
    const statusCode = Number(response.statusCode || 0);
    const location = typeof response.headers.location === "string" ? response.headers.location : "";
    if (statusCode >= 300 && statusCode < 400 && location) {
      response.resume();
      if (redirectCount >= 4) return finishError(new Error("Remote preview redirected too many times."));
      let redirected = "";
      try { redirected = new URL(location, remoteUrl).toString(); } catch (_error) {}
      if (!trustedRemoteAudioUrl(redirected)) return finishError(new Error("Remote preview redirected to an untrusted address."));
      settled = true;
      readRemoteAudioWithNode(redirected, shouldContinue, redirectCount + 1).then(resolve, reject);
      return;
    }
    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      finishError(new Error(`Remote preview failed (HTTP ${statusCode}).`));
      return;
    }
    const contentLength = Number(response.headers["content-length"] || 0);
    if (contentLength > MAX_DECODE_BYTES) {
      response.resume();
      finishError(new Error("Remote preview is too large to decode."));
      return;
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    response.on("data", (chunk: Uint8Array) => {
      if (settled) return;
      if (shouldContinue && !shouldContinue()) {
        request.abort();
        finishError(new DOMException("Waveform decoding was cancelled.", "AbortError"));
        return;
      }
      total += chunk.length;
      if (total > MAX_DECODE_BYTES) {
        request.abort();
        finishError(new Error("Remote preview is too large to decode."));
        return;
      }
      chunks.push(chunk);
    });
    response.on("end", () => {
      if (settled) return;
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (let index = 0; index < chunks.length; index += 1) {
        bytes.set(chunks[index], offset);
        offset += chunks[index].length;
      }
      settled = true;
      resolve(bytes.buffer);
    });
    response.on("error", (error) => finishError(error instanceof Error ? error : new Error(String(error))));
  });
  request.setTimeout(12000, () => {
    request.abort();
    finishError(new Error("Remote preview timed out."));
  });
  request.on("error", (error) => finishError(error instanceof Error ? error : new Error(String(error))));
});

const readRemoteAudio = async (remoteUrl: string, shouldContinue?: () => boolean): Promise<ArrayBuffer> => {
  if (!trustedRemoteAudioUrl(remoteUrl)) throw new Error("Untrusted remote audio URL.");
  if (shouldContinue && !shouldContinue()) throw new DOMException("Waveform decoding was cancelled.", "AbortError");
  if (!window.cep) {
    const response = await fetch(remoteUrl);
    if (!response.ok) throw new Error(`Remote preview failed (HTTP ${response.status}).`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_DECODE_BYTES) throw new Error("Remote preview is too large to decode.");
    return bytes;
  }
  return readRemoteAudioWithNode(remoteUrl, shouldContinue);
};

const extractPeaks = (samples: Float32Array, bins: number) => {
  const peaks = new Float32Array(bins * 2);
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor((bin * samples.length) / bins);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor(((bin + 1) * samples.length) / bins)));
    let minimum = 0;
    let maximum = 0;
    for (let index = start; index < end; index += 1) {
      const value = samples[index];
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    }
    peaks[bin * 2] = minimum;
    peaks[bin * 2 + 1] = maximum;
  }
  return peaks;
};

const rememberChannels = (key: string, channels: Float32Array[]) => {
  channelCache.delete(key);
  channelCache.set(key, channels);
  while (channelCache.size > MAX_CACHE_ENTRIES) {
    const oldest = channelCache.keys().next().value as string | undefined;
    if (!oldest) break;
    channelCache.delete(oldest);
  }
};

const decodeAudioBytes = async (
  bytes: ArrayBuffer,
  cacheKey: string,
  shouldContinue?: () => boolean,
) => {
  const cached = channelCache.get(cacheKey);
  if (cached) {
    rememberChannels(cacheKey, cached);
    return cached;
  }
  const AudioContextConstructor = window.AudioContext;
  if (!AudioContextConstructor || (shouldContinue && !shouldContinue())) return [];
  let context: AudioContext | null = null;
  try {
    context = new AudioContextConstructor();
    const audioBuffer = await context.decodeAudioData(bytes);
    if (shouldContinue && !shouldContinue()) return [];
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      channels.push(extractPeaks(audioBuffer.getChannelData(channel), PEAK_BINS));
    }
    rememberChannels(cacheKey, channels);
    return channels;
  } finally {
    try { if (context) await context.close(); } catch (_error) {}
  }
};

export const decodeAudioWaveformChannels = async (
  filePath: string,
  fileSize: number,
  modifiedAt: number,
  durationSeconds = 0,
  shouldContinue?: () => boolean,
): Promise<Float32Array[]> => {
  if (
    !filePath
    || !window.cep
    || fileSize > MAX_DECODE_BYTES
    || durationSeconds > MAX_DECODE_DURATION_SECONDS
    || typeof fs.readFile !== "function"
    || (shouldContinue && !shouldContinue())
  ) return [];
  const cacheKey = `${filePath}:${modifiedAt}:${fileSize}`;
  const cached = channelCache.get(cacheKey);
  if (cached) {
    rememberChannels(cacheKey, cached);
    return cached;
  }

  try {
    const bytes = await readAudioFile(filePath);
    if (shouldContinue && !shouldContinue()) return [];
    return await decodeAudioBytes(bytes, cacheKey, shouldContinue);
  } catch (_error) {
    return [];
  }
};

export const decodeRemoteAudioWaveformChannels = async (
  remoteUrl: string,
  durationSeconds = 0,
  shouldContinue?: () => boolean,
) => {
  if (!remoteUrl || durationSeconds > MAX_DECODE_DURATION_SECONDS || (shouldContinue && !shouldContinue())) return [];
  const cacheKey = `remote:${remoteUrl}`;
  const cached = channelCache.get(cacheKey);
  if (cached) {
    rememberChannels(cacheKey, cached);
    return cached;
  }
  try {
    const bytes = await readRemoteAudio(remoteUrl, shouldContinue);
    return await decodeAudioBytes(bytes, cacheKey, shouldContinue);
  } catch (_error) {
    return [];
  }
};

const processedPreviewSourceKey = (sound: SoundFile) => sound.path
  ? `file:${sound.path}:${sound.modifiedAt}:${sound.size}`
  : `remote:${sound.previewUrl || ""}`;

const decodeProcessedPreviewSource = async (sound: SoundFile, signal?: AbortSignal) => {
  const key = processedPreviewSourceKey(sound);
  if (processedPreviewDecodeCache?.key === key) {
    const cached = processedPreviewDecodeCache.buffer;
    retainProcessedPreviewDecode(key, cached);
    return cached;
  }
  if (processedPreviewDecodeCache) processedPreviewDecodeCache = null;

  let pending = processedPreviewDecodePending?.key === key ? processedPreviewDecodePending.promise : null;
  if (!pending) {
    pending = (async () => {
      const bytes = sound.path
        ? await readAudioFile(sound.path)
        : (sound.previewUrl || "").startsWith("data:")
          ? await (await fetch(sound.previewUrl || "")).arrayBuffer()
          : await readRemoteAudio(sound.previewUrl || "");
      const AudioContextConstructor = window.AudioContext;
      if (!AudioContextConstructor) throw new Error("The CEP audio decoder is unavailable.");
      let context: AudioContext | null = null;
      try {
        context = new AudioContextConstructor();
        const decoded = await context.decodeAudioData(bytes);
        const decodedBytes = decoded.length * decoded.numberOfChannels * 4;
        if (!Number.isFinite(decodedBytes) || decodedBytes > MAX_PREVIEW_PCM_BYTES) {
          throw new Error("This sound needs too much memory for live effects preview. Processed import is still available.");
        }
        return decoded;
      } finally {
        try { if (context) await context.close(); } catch (_error) {}
      }
    })();
    processedPreviewDecodePending = { key, promise: pending };
  }

  try {
    const decoded = await pending;
    if (processedPreviewDecodePending?.promise === pending) {
      retainProcessedPreviewDecode(key, decoded);
      processedPreviewDecodePending = null;
    }
    if (signal?.aborted) throw new DOMException("Audio effects preview was cancelled.", "AbortError");
    return decoded;
  } catch (error) {
    if (processedPreviewDecodePending?.promise === pending) processedPreviewDecodePending = null;
    throw error;
  }
};

export const renderProcessedPreview = async (
  sound: SoundFile,
  selection: AudioSegmentSelection | null,
  processing: AudioProcessingSettings,
  signal?: AbortSignal,
) => {
  if (sound.duration > MAX_DECODE_DURATION_SECONDS) throw new Error("Audio effects preview is limited to two-minute sounds. The processed import is still available.");
  if (sound.path && sound.size > MAX_DECODE_BYTES) throw new Error("This file is too large for an in-panel effects preview. The processed import is still available.");
  const decoded = await decodeProcessedPreviewSource(sound, signal);
  const startFrame = selection ? Math.floor(Math.max(0, selection.start) * decoded.sampleRate) : 0;
  const endFrame = selection ? Math.ceil(Math.min(decoded.duration, selection.end) * decoded.sampleRate) : decoded.length;
  const rendered = await renderAudioProcessing(decoded, processing, "preserve", signal, startFrame, endFrame);
  const wave = await encodeRenderedWave(rendered, 16, signal);
  return {
    url: URL.createObjectURL(new Blob([wave], { type: "audio/wav" })),
    duration: rendered.duration,
    channels: rendered.channels.length,
  };
};
