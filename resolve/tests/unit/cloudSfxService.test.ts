import { describe, expect, test } from "bun:test";
import { driveReferenceId, mapCloudSfxResponse, validateCloudSfxUrl } from "../../src/main/services/cloudSfxService";

describe("Cloud SFX trust boundary", () => {
  test("accepts only exact Cloud SFX endpoints and IDs", () => {
    expect(validateCloudSfxUrl("https://aiscorpionsfx.com/search.php?q=wind", "/search.php"))
      .toBe("https://aiscorpionsfx.com/search.php?q=wind");
    expect(validateCloudSfxUrl("https://aiscorpionsfx.com/download.php?id=file_1", "/download.php"))
      .toBe("https://aiscorpionsfx.com/download.php?id=file_1");
    expect(() => validateCloudSfxUrl("https://aiscorpionsfx.com.evil.test/search.php?q=wind", "/search.php")).toThrow("not trusted");
    expect(() => validateCloudSfxUrl("https://aiscorpionsfx.com/search.php?q=wind&url=https://evil.test", "/search.php")).toThrow("invalid");
    expect(() => validateCloudSfxUrl("https://aiscorpionsfx.com/get_preview_url.php?id=../1", "/get_preview_url.php")).toThrow("invalid");
  });

  test("extracts IDs only from accepted Drive references", () => {
    expect(driveReferenceId("https://drive.google.com/uc?export=download&id=preview_test")).toBe("preview_test");
    expect(driveReferenceId("https://drive.google.com/file/d/full-test/view")).toBe("full-test");
    expect(() => driveReferenceId("https://drive.google.com.evil.test/uc?id=bad")).toThrow("invalid Drive reference");
    expect(() => driveReferenceId("https://drive.google.com/uc?id=ok&continue=https://evil.test")).toThrow("invalid Drive reference");
  });

  test("maps only bounded valid search records", () => {
    expect(mapCloudSfxResponse([
      { id: 101, name: " Watery Whoosh ", preview_key: "previews/test.mp3" },
      { id: -1, name: "bad", preview_key: "x" },
      { id: 102, name: "missing preview" },
    ])).toEqual([{ id: "101", name: "Watery Whoosh" }]);
  });
});
