import path from "node:path";
import { statSync } from "node:fs";
import { nativeImage } from "electron";
import { ResolveHostError } from "./resolveHost";

// A tiny neutral drag image. Resolve receives the actual WAV path; this image
// is only the cursor affordance required by Electron's native drag API.
const DRAG_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
let dragIcon: ReturnType<typeof nativeImage.createFromBuffer> | null = null;

export const validateDragPath = (value: string): string => {
  if (!path.isAbsolute(value) || path.extname(value).toLocaleLowerCase("en-US") !== ".wav") {
    throw new ResolveHostError("INVALID_AUDIO_PATH", "Native drag accepts an absolute WAV path only.");
  }
  const details = statSync(value, { throwIfNoEntry: false });
  if (!details?.isFile()) throw new ResolveHostError("AUDIO_NOT_FOUND", "The selected WAV no longer exists.");
  return path.resolve(value);
};

export const startNativeDrag = (sender: unknown, requestedPath: string): void => {
  const file = validateDragPath(requestedPath);
  if (!sender || typeof (sender as any).startDrag !== "function") {
    throw new ResolveHostError("WINDOW_UNAVAILABLE", "The SoundDesigner renderer cannot start a native file drag.");
  }
  dragIcon ||= nativeImage.createFromBuffer(Buffer.from(DRAG_IMAGE, "base64"));
  if (dragIcon.isEmpty()) throw new ResolveHostError("DRAG_ICON_INVALID", "The native drag image could not be created.");
  (sender as any).startDrag({ file, icon: dragIcon });
};
