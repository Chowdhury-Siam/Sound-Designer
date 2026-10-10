import { describe, expect, test } from "bun:test";
import { downloadFreesoundAudio, extensionFromFreesoundUrl, searchFreesoundApi, validateFreesoundAudioUrl, validateFreesoundSearchUrl } from "../../src/main/services/freesoundService";

describe("Freesound native networking", () => {
  test("follows a bounded trusted audio redirect", async () => {
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (url) => {
      requested.push(String(url));
      return requested.length === 1
        ? new Response(null, { status: 302, headers: { location: "https://cdn.freesound.org/audio.wav" } })
        : new Response(new Uint8Array([1, 2, 3]));
    }) as typeof fetch;
    try {
      expect(await downloadFreesoundAudio("https://freesound.org/preview.wav", new AbortController().signal, () => {})).toEqual(new Uint8Array([1, 2, 3]));
      expect(requested).toEqual(["https://freesound.org/preview.wav", "https://cdn.freesound.org/audio.wav"]);
    } finally { globalThis.fetch = original; }
  });
  test("accepts only the current Freesound search endpoint and strips URL tokens", () => {
    expect(validateFreesoundSearchUrl("https://freesound.org/apiv2/search/?query=wind&token=secret"))
      .toBe("https://freesound.org/apiv2/search/?query=wind");
    expect(() => validateFreesoundSearchUrl("https://freesound.org/apiv2/users/me/"))
      .toThrow("Only the Freesound search API");
  });

  test("rejects lookalike and insecure audio hosts", () => {
    expect(() => validateFreesoundAudioUrl("https://freesound.org.attacker.test/audio.mp3")).toThrow("not trusted");
    expect(() => validateFreesoundAudioUrl("http://cdn.freesound.org/audio.mp3")).toThrow("not trusted");
  });

  test("normalizes supported preview extensions", () => {
    expect(extensionFromFreesoundUrl("https://cdn.freesound.org/previews/1/123_hq.ogg?x=1")).toBe("ogg");
    expect(extensionFromFreesoundUrl("https://cdn.freesound.org/previews/1/123_hq.bin")).toBe("mp3");
  });

  test("rejects untrusted download redirects before requesting their target", async () => {
    const original = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (url, options) => {
      requests.push(String(url));
      expect(options?.redirect).toBe("manual");
      return new Response(null, { status: 302, headers: { location: "https://attacker.test/audio.wav" } });
    }) as typeof fetch;
    try {
      await expect(downloadFreesoundAudio("https://cdn.freesound.org/preview.wav", new AbortController().signal, () => {})).rejects.toThrow("not trusted");
      expect(requests).toHaveLength(1);
    } finally { globalThis.fetch = original; }
  });

  test("bounds chunked search JSON before fully buffering it", async () => {
    const original = globalThis.fetch;
    let cancelled = false;
    let chunks = 0;
    globalThis.fetch = (async (_url, options) => {
      expect(options?.redirect).toBe("error");
      return new Response(new ReadableStream({
        pull(controller) { chunks++; controller.enqueue(new Uint8Array(1024 * 1024)); },
        cancel() { cancelled = true; },
      }));
    }) as typeof fetch;
    try {
      await expect(searchFreesoundApi("https://freesound.org/apiv2/search/?query=wind", "fixture-key", new AbortController().signal)).rejects.toThrow("oversized");
      expect(cancelled).toBe(true);
      expect(chunks).toBeLessThanOrEqual(4);
    } finally { globalThis.fetch = original; }
  });
});
