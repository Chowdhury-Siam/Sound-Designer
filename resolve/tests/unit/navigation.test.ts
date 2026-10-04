import { describe, expect, test } from "bun:test";
import path from "node:path";
import { isSupportedMediaPath, resolveMediaRange, resolveUiAssetPath } from "../../src/main/uiProtocol";

describe("packaged renderer navigation allowlist", () => {
  test("accepts only the private renderer origin", () => {
    const entry = new URL("sounddesigner://app/index.html");
    const asset = new URL("sounddesigner://app/assets/index.js");
    const external = new URL("https://example.com");
    expect([entry.protocol, entry.host]).toEqual(["sounddesigner:", "app"]);
    expect([asset.protocol, asset.host]).toEqual(["sounddesigner:", "app"]);
    expect([external.protocol, external.host]).not.toEqual(["sounddesigner:", "app"]);
  });

  test("normalizes standard and opaque-host URL shapes inside the UI root", () => {
    const root = path.resolve("Plugin", "ui");
    expect(resolveUiAssetPath("sounddesigner://app/index.html", root)).toBe(path.join(root, "index.html"));
    expect(resolveUiAssetPath("sounddesigner:////app/assets/index.js", root)).toBe(path.join(root, "assets", "index.js"));
    expect(resolveUiAssetPath("sounddesigner://app/%2e%2e%5coutside.txt", root)).toBeNull();
    expect(resolveUiAssetPath("https://example.com/index.html", root)).toBeNull();
  });
});

describe("local media byte ranges", () => {
  test("allows only absolute audio paths on the media origin", () => {
    expect(isSupportedMediaPath(path.resolve("Audio", "hit.WAV"))).toBe(true);
    expect(isSupportedMediaPath(path.resolve("Users", "person", "private.png"))).toBe(false);
    expect(isSupportedMediaPath("relative.wav")).toBe(false);
  });

  test("serves bounded and open-ended audio ranges", () => {
    expect(resolveMediaRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(resolveMediaRange("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(resolveMediaRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });

  test("rejects ranges outside the media file", () => {
    expect(resolveMediaRange("bytes=1000-", 1000)).toBeNull();
    expect(resolveMediaRange("not-a-range", 1000)).toBeNull();
  });

  test("bounds open-ended streaming reads without changing the requested start", () => {
    expect(resolveMediaRange("bytes=100-", 10_000, 1024)).toEqual({ start: 100, end: 1123 });
  });
});
