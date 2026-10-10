import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { createRequire } from "node:module";
import { mock } from "bun:test";
import { registerPlatform } from "../src/js/platform/client";
import type { SoundDesignerPlatform } from "../src/js/platform/types";

registerPlatform({ capabilities: { nativeCloud: false } } as SoundDesignerPlatform);
(globalThis as any).window = { cep: {} };
(globalThis as any).require = createRequire(import.meta.url);
mock.module("../src/js/lib/utils/bolt", () => ({ csi: {} }));
const original = https.get;
(https as any).get = (_url: string, _options: unknown, callback: (response: any) => void) => {
  const request = new EventEmitter() as any;
  request.setTimeout = () => request;
  request.abort = () => request;
  queueMicrotask(() => {
    const response = new EventEmitter() as any;
    response.statusCode = 200;
    response.setEncoding = () => response;
    callback(response);
    response.emit("data", "{invalid-json");
    response.emit("end");
  });
  return request;
};
try {
  const { searchFreesound } = await import("../src/js/main/freesound");
  let timer: ReturnType<typeof setTimeout>;
  try {
    await assert.rejects(Promise.race([
      searchFreesound("whoosh", "fixture-key", "all"),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Search hung")), 200); }),
    ]), /invalid response/, "Malformed JSON must reject, not leave the search pending forever");
  } finally { clearTimeout(timer!); }
  console.log("Freesound malformed-response regression passed.");
} finally { https.get = original; }
