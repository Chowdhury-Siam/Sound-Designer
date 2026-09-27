import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { createRequire } from "node:module";

// Run this with native Node after bundling. Bun supplies a default User-Agent
// that native CEP Node does not, so it cannot catch the original HTTP 403 bug.
(globalThis as any).window = { cep: {} };
(globalThis as any).require = createRequire(import.meta.url);
globalThis.fetch = (async () => { throw new TypeError("Simulated CEF network failure"); }) as typeof fetch;
const originalGet = https.get;
(https as any).get = (_url: string, options: { headers: Record<string, string> }, callback: (response: any) => void) => {
  assert.equal(options.headers["User-Agent"], "SoundDesigner CEP");
  assert.equal(options.headers.Accept, "application/json");
  const req = new EventEmitter() as any;
  req.setTimeout = () => req;
  req.abort = () => req;
  queueMicrotask(() => {
    const response = new EventEmitter() as any;
    response.statusCode = 200;
    response.setEncoding = () => response;
    callback(response);
    response.emit("data", JSON.stringify([{ id: 101, name: "Whoosh", preview_key: "previews/whoosh.mp3" }]));
    response.emit("end");
  });
  return req;
};
try {
  const { searchCloudLibrary } = await import("../src/js/main/cloudLibrary");
  const sounds = await searchCloudLibrary("whoosh");
  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].source, "scorpion");
  console.log("Native Node cloud request regression test passed.");
} finally {
  https.get = originalGet;
}
