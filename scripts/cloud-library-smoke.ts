import assert from "node:assert/strict";
import { mock } from "bun:test";
import { registerPlatform } from "../src/js/platform/client";
import type { SoundDesignerPlatform } from "../src/js/platform/types";
registerPlatform({ capabilities: { nativeCloud: false } } as SoundDesignerPlatform);
(globalThis as any).window = { cep: undefined };
const storage = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
const cloud = await import("../src/js/main/cloudLibrary");
assert.equal(cloud.loadCloudEnabled(), true);
cloud.saveCloudEnabled(false);
assert.equal(cloud.loadCloudEnabled(), false);
assert.equal(cloud.isLibraryMediaUrl("https://aiscorpionsfx.com.evil.test/download.php?id=x"), false);
assert.equal(cloud.isLibraryMediaUrl("http://aiscorpionsfx.com/download.php?id=x"), false);
let requested = "";
globalThis.fetch = (async (url: string) => {
  requested = String(url);
  return new Response(JSON.stringify([{ id: 101, name: "Watery Whoosh", preview_key: "previews/test.mp3" }, { id: -1, name: "bad" }]), { status: 200 });
}) as typeof fetch;
const sounds = await cloud.searchCloudLibrary("water & wind");
assert.ok(requested.includes("water%20%26%20wind"));
assert.equal(sounds.length, 1);
assert.equal(sounds[0].source, "scorpion");
assert.equal(sounds[0].previewUrl, undefined);
let mediaRequests = 0;
globalThis.fetch = (async () => {
  mediaRequests += 1;
  return new Response(JSON.stringify({ preview_url: "https://drive.google.com/uc?export=download&id=preview_test", download_url: "https://drive.google.com/uc?export=download&id=full_test" }), { status: 200 });
}) as typeof fetch;
assert.equal(await cloud.resolveCloudPreview(sounds[0]), "https://aiscorpionsfx.com/download.php?id=preview_test");
assert.equal(await cloud.resolveCloudPreview(sounds[0]), "https://aiscorpionsfx.com/download.php?id=preview_test");
assert.equal(mediaRequests, 1, "Resolved preview URLs should be cached");
assert.equal(await cloud.resolveCloudDownload(sounds[0]), "https://aiscorpionsfx.com/download.php?id=full_test");
globalThis.fetch = (async () => new Response(JSON.stringify({ download_url: "https://example.com/uc?id=bad" }), { status: 200 })) as typeof fetch;
await assert.rejects(cloud.resolveCloudDownload(sounds[0]), /invalid download/);
mock.module("../src/js/main/freesound", () => ({
  searchFreesound: async () => ({ sounds: [], total: 0, page: 1, hasNext: false }),
}));
globalThis.fetch = (async () => new Response("Forbidden", { status: 403 })) as typeof fetch;
await assert.rejects(
  cloud.searchSoundSources("keyboard", "test-key", "all", 1, true, true),
  /403/,
  "An empty Freesound response must not mask Cloud SFX failure",
);
let cancelled = false;
globalThis.fetch = (async () => new Response(new ReadableStream({
  pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
  cancel() { cancelled = true; },
}))) as typeof fetch;
await assert.rejects(cloud.searchCloudLibrary("oversized"), /too large/);
assert.equal(cancelled, true, "Oversized chunked cloud responses must stop reading");
console.log("Cloud library smoke test passed.");
