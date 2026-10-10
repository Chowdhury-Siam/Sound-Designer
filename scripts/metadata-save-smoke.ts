import assert from "node:assert/strict";
import { mock } from "bun:test";
import { registerPlatform } from "../src/js/platform/client";
import type { SoundDesignerPlatform } from "../src/js/platform/types";

(globalThis as any).window = { cep: undefined, setTimeout, clearTimeout };
const stored = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) };
mock.module("../src/js/lib/utils/bolt", () => ({ csi: {} }));
let reads = 0;
const writes: Array<{ value: any; source: any; finish: (result: any) => void }> = [];
registerPlatform({ mode: "resolve", capabilities: { nativeStorage: true }, storage: {
  getLibraryMetadata: async () => { reads++; return { ok: true, data: { version: 1, sounds: {}, folders: {}, collections: [], updatedAt: 0 } }; },
  saveLibraryMetadata: (value: unknown) => new Promise(finish => writes.push({ value: structuredClone(value), source: value, finish })),
} } as unknown as SoundDesignerPlatform);
const metadata = await import("../src/js/main/libraryMetadata");
const first = [{ id: "one", name: "Whoosh", parentId: "" }];
metadata.saveFavoriteCollections(first);
metadata.flushLibraryMetadata();
assert.deepEqual(writes[0].value.collections, first);
metadata.flushLibraryMetadata();
assert.equal(writes.length, 1, "Repeated flushes must not save the same pending revision twice");
await metadata.loadPortableLibraryMetadata();
assert.equal(reads, 0, "Focus refresh must not overwrite a pending save");
writes[0].finish({ ok: false, error: { message: "Disk unavailable" } });
await Promise.resolve();
await metadata.loadPortableLibraryMetadata();
assert.equal(reads, 0, "A failed save must remain dirty");
metadata.flushLibraryMetadata();
const second = [{ id: "two", name: "Impact", parentId: "" }];
metadata.saveFavoriteCollections(second);
assert.deepEqual(writes[1].source.collections, first, "Pending storage writes receive an immutable snapshot of the earlier edit");
writes[1].finish({ ok: true });
await Promise.resolve();
await metadata.loadPortableLibraryMetadata();
assert.equal(reads, 0, "An earlier save must not clear newer edits");
assert.deepEqual(metadata.loadFavoriteCollections(), second);
metadata.flushLibraryMetadata();
writes[2].finish({ ok: true });
await Promise.resolve();
await metadata.loadPortableLibraryMetadata();
assert.equal(reads, 1, "A completed latest save allows refresh again");
console.log("Metadata pending/failed-save regressions passed.");
