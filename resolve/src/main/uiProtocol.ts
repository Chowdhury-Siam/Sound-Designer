import path from "node:path";

const SCHEME = "sounddesigner:";
const OPTIONAL_HOST_PREFIX = "app/";
const AUDIO_EXTENSIONS = new Set([".aac", ".aif", ".aiff", ".caf", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".wma"]);

export const isSupportedMediaPath = (filePath: string): boolean =>
  path.isAbsolute(filePath) && AUDIO_EXTENSIONS.has(path.extname(filePath).toLocaleLowerCase("en-US"));

export const resolveUiAssetPath = (requestUrl: string, uiRoot: string): string | null => {
  const parsed = new URL(requestUrl);
  if (parsed.protocol !== SCHEME) return null;

  let relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
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
  if (!match || size <= 0) return null;
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
