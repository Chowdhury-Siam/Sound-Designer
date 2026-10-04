import { describe, expect, test } from "bun:test";
import { ContractError, parseExternalUrl, parseImportAudioRequest, parseInsertAudioRequest } from "../../src/shared/contracts";

describe("IPC contracts", () => {
  test("normalizes an import request", () => {
    expect(parseImportAudioRequest({ path: " C:\\Audio\\hit.wav ", sourceId: " local:1 ", displayName: " hit.wav " })).toEqual({
      path: "C:\\Audio\\hit.wav",
      sourceId: "local:1",
      displayName: "hit.wav",
    });
  });

  test("rejects invalid insertion fields", () => {
    expect(() => parseInsertAudioRequest({ preparedPath: "x.wav", channelMode: "surround" })).toThrow(ContractError);
    expect(() => parseInsertAudioRequest({ preparedPath: "x.wav", channelMode: "mono", trackIndex: 0 })).toThrow("positive integer");
  });

  test("accepts a bounded optional track", () => {
    expect(parseInsertAudioRequest({ preparedPath: "C:\\Audio\\hit.wav", displayName: "Hit", channelMode: "stereo", trackIndex: 4 })).toEqual({
      preparedPath: "C:\\Audio\\hit.wav",
      displayName: "Hit",
      channelMode: "stereo",
      trackIndex: 4,
      mediaPoolItemId: undefined,
      target: "playhead",
    });
  });

  test("accepts the selected Fairlight track target", () => {
    expect(parseInsertAudioRequest({ preparedPath: "C:\\Audio\\hit.wav", displayName: "Hit", channelMode: "mono", target: "fairlight-selected-track" }).target)
      .toBe("fairlight-selected-track");
  });

  test("validates optional project identity at the IPC boundary", () => {
    expect(parseImportAudioRequest({ path: "C:\\Audio\\hit.wav", sourceId: "local:1", displayName: "hit.wav", projectId: " project-1 " }).projectId)
      .toBe("project-1");
    expect(() => parseInsertAudioRequest({ preparedPath: "x.wav", displayName: "Hit", channelMode: "mono", projectId: " " }))
      .toThrow("projectId is required");
  });

  test("opens only trusted product and Freesound links", () => {
    expect(parseExternalUrl("https://freesound.org/apiv2/apply/")).toBe("https://freesound.org/apiv2/apply/");
    expect(parseExternalUrl("https://github.com/iboyshanto/SoundDesigner/releases/download/v1.0.4/Setup.exe"))
      .toBe("https://github.com/iboyshanto/SoundDesigner/releases/download/v1.0.4/Setup.exe");
    expect(() => parseExternalUrl("https://github.com/iboyshanto/SoundDesigner/releases-fake/download.exe")).toThrow("untrusted external URL");
    expect(parseExternalUrl("https://github.com/its-niloy/SoundDesigner-Resolve/releases/download/v1.0/app.zip"))
      .toBe("https://github.com/its-niloy/SoundDesigner-Resolve/releases/download/v1.0/app.zip");
    expect(() => parseExternalUrl("https://example.com/phishing")).toThrow("untrusted external URL");
    expect(() => parseExternalUrl("https://user:password@freesound.org/search/")).toThrow("untrusted external URL");
  });
});
