import { describe, expect, test } from "bun:test";
import { parseFrameRate, timecodeToFrames } from "../../src/shared/timecode";

describe("Resolve timecode conversion", () => {
  test("converts non-drop timecode in absolute timeline frame space", () => {
    expect(timecodeToFrames("01:00:00:00", 24)).toBe(86400);
    expect(timecodeToFrames("00:00:10:12", 24)).toBe(252);
  });

  test("accounts for 29.97 drop-frame labels", () => {
    expect(timecodeToFrames("00:10:00;00", 29.97)).toBe(17982);
    expect(timecodeToFrames("01:00:00;00", 29.97)).toBe(107892);
  });

  test("rejects malformed values", () => {
    expect(() => timecodeToFrames("10 seconds", 24)).toThrow("invalid playhead");
    expect(() => timecodeToFrames("00:00:00:24", 24)).toThrow("out-of-range");
    expect(() => parseFrameRate("unknown")).toThrow("unsupported timeline frame rate");
  });
});
