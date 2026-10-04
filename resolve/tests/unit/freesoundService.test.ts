import { describe, expect, test } from "bun:test";
import { extensionFromFreesoundUrl, validateFreesoundAudioUrl, validateFreesoundSearchUrl } from "../../src/main/services/freesoundService";

describe("Freesound native networking", () => {
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
});
