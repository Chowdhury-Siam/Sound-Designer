import path from "node:path";
import { AUDIO_INPUT_EXTENSIONS } from "../shared/audioFormats";

const SCHEME = "sounddesigner:";
const OPTIONAL_HOST_PREFIX = "app/";

export const isTrustedUiSender = (event: { sender?: { mainFrame?: unknown }; senderFrame?: { url?: string } | null }): boolean =>
  Boolean(event.senderFrame && event.senderFrame === event.sender?.mainFrame && event.senderFrame.url === "sounddesigner://app/index.html");

export const isSupportedMediaPath = (filePath: string): boolean =>
  path.isAbsolute(filePath) && AUDIO_INPUT_EXTENSIONS.has(path.extname(filePath).slice(1).toLocaleLowerCase("en-US"));

export const resolveUiAssetPath = (requestUrl: string, uiRoot: string): string | null => {
  let parsed: URL;
  let relativePath: string;
  try {
    parsed = new URL(requestUrl);
    relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  } catch { return null; }
  if (parsed.protocol !== SCHEME || (parsed.host && parsed.host !== "app") || parsed.username || parsed.password) return null;
  // Some embedded Electron builds expose the custom URL as an opaque path and
  // include the nominal host in pathname instead of URL.host.
  if (relativePath.startsWith(OPTIONAL_HOST_PREFIX)) {
    relativePath = relativePath.slice(OPTIONAL_HOST_PREFIX.length);
  }
  if (!relativePath) relativePath = "index.html";

  const absoluteRoot = path.resolve(uiRoot);
  const filePath = path.resolve(absoluteRoot, relativePath);
  const relativeToRoot = path.relative(absoluteRoot, filePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
  return filePath;
};

export const resolveMediaRange = (header: string | null, size: number, maximumBytes = Number.POSITIVE_INFINITY): { start: number; end: number } | null => {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;
  if ([match[1], match[2]].some(value => value && !Number.isSafeInteger(Number(value)))) return null;
  const requestedStart = match[1] ? Number(match[1]) : Number.NaN;
  const requestedEnd = match[2] ? Number(match[2]) : Number.NaN;
  const start = Number.isFinite(requestedStart)
    ? requestedStart
    : Number.isFinite(requestedEnd) ? Math.max(0, size - requestedEnd) : 0;
  const requestedLastByte = Number.isFinite(requestedEnd) && match[1] ? Math.min(size - 1, requestedEnd) : size - 1;
  const end = Math.min(requestedLastByte, start + maximumBytes - 1);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end };
};
