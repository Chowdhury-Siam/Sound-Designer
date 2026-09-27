import assert from "node:assert/strict";
import { rankSfxSounds, soundPeakOffset, suggestSfx, type SfxMoment } from "../src/js/main/sfxAssistant";
import type { SoundFile } from "../src/js/main/types";

const sound = (id: string, name: string, duration: number, favorite = false): SoundFile => ({
  id, name, duration, favorite, path: `/library/${id}.wav`, folderId: "library", directoryId: "library",
  extension: "wav", size: 1000, modifiedAt: 0, tags: [], waveform: new Float32Array([0.1, 0.8, 0.2]),
  waveformReal: true, accent: "graphite", source: "local",
});
const click: SfxMoment = { time: 1, duration: 0.15, intensity: 2, type: "click", layer: "Button", reason: "Scale change" };
const whoosh: SfxMoment = { time: 2, duration: 0.6, intensity: 3, type: "whoosh", layer: "Card", reason: "Position change" };
const library = [sound("a", "Soft UI Click", 0.2, true), sound("b", "Digital Whoosh", 0.8), sound("c", "Soft UI Click Alt", 0.25)];

assert.equal(rankSfxSounds(click, library)[0].id, "a", "Click event should match a relevant short favorite");
assert.equal(rankSfxSounds(whoosh, library)[0].id, "b", "Whoosh event should match a whoosh");
assert.equal(rankSfxSounds(click, [sound("wrong", "Ambience", 2)])[0], undefined, "Unrelated audio must not be placed automatically");
assert.equal(soundPeakOffset(library[0]), 0.2 / 3, "Peak alignment must use the cached real waveform");
assert.equal(soundPeakOffset({ ...library[0], waveformReal: false }), 0, "Synthetic waveforms must not control alignment");
assert.deepEqual(suggestSfx([click, whoosh], library).map(item => item?.id), ["a", "b"]);
console.log("SFX Assistant matching tests passed.");
