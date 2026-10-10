import assert from "node:assert/strict";
import { mock } from "bun:test";
import { registerPlatform } from "../src/js/platform/client";
import type { SoundDesignerPlatform } from "../src/js/platform/types";

mock.module("../src/js/lib/cep/node", () => ({ fs: {}, https: {}, path: {} }));
mock.module("../src/js/lib/utils/bolt", () => ({ csi: {} }));
let reads = 0;
let closes = 0;
let decodes = 0;
let bytes = new Uint8Array([1, 2, 3]);
let decodedBytes: ArrayBuffer | undefined;
let decodedDuration = 1;
let decodedLength = 4;
let failDecode = false;
const samples = new Float32Array([-0.5, 0.2, -0.1, 0.75]);
(globalThis as any).window = {
  AudioContext: class {
    async decodeAudioData(value: ArrayBuffer) {
      decodes++;
      decodedBytes = value;
      if (failDecode) throw new Error("Unsupported format");
      return { duration: decodedDuration, length: decodedLength, numberOfChannels: 1, getChannelData: () => samples };
    }
    async close() { closes++; }
  },
};
registerPlatform({ capabilities: { nativeAudioPreparation: true, nativeCloud: true },
  audio: { readFile: async () => { reads++; return { ok: true, data: bytes }; } },
  cloud: { readFreesoundPreview: async () => { reads++; return { ok: true, data: bytes }; } },
} as unknown as SoundDesignerPlatform);
const { decodeAudioWaveformChannels, decodeRemoteAudioWaveformChannels, compactWaveformFromChannels } = await import("../src/js/main/audioWaveform");
const initial = await decodeAudioWaveformChannels("full.wav", 3, 1, 1);
assert.equal(decodedBytes, bytes.buffer, "Full-span native bytes are decoded without another buffer copy");
assert.equal(initial.length, 1);
assert.equal(initial[0].length, 3072, "Peak detail is preserved");
assert.ok(compactWaveformFromChannels(initial).some(value => value > 0));
const beforeCached = reads;
assert.equal(await decodeAudioWaveformChannels("full.wav", 3, 1, 1), initial);
assert.equal(reads, beforeCached, "Cached waveforms perform no native reads");
bytes = new Uint8Array([99, 1, 2, 3, 99]).subarray(1, 4);
await decodeAudioWaveformChannels("view.wav", 3, 1, 1);
assert.deepEqual([...new Uint8Array(decodedBytes!)], [1, 2, 3], "Native subviews exclude unrelated buffer bytes");
assert.notEqual(decodedBytes, bytes.buffer);
bytes = new Uint8Array([4, 5, 6]);
await decodeRemoteAudioWaveformChannels("https://cdn.freesound.org/test.mp3", 1);
assert.equal(decodedBytes, bytes.buffer, "Native remote preview bytes also avoid a duplicate copy");
const beforeRejected = reads;
assert.deepEqual(await decodeAudioWaveformChannels("large.wav", 33 * 1024 * 1024, 1, 1), []);
assert.deepEqual(await decodeAudioWaveformChannels("cancelled.wav", 3, 1, 1, () => false), []);
assert.equal(reads, beforeRejected, "Oversized and cancelled requests do no I/O");
decodedDuration = 121;
assert.deepEqual(await decodeAudioWaveformChannels("unknown-long.wav", 3, 1, 0), []);
decodedDuration = 1;
decodedLength = 30 * 1024 * 1024;
assert.deepEqual(await decodeAudioWaveformChannels("unknown-large-pcm.wav", 3, 1, 0), []);
decodedLength = 4;
failDecode = true;
assert.deepEqual(await decodeAudioWaveformChannels("unsupported.wav", 3, 1, 0), []);
failDecode = false;
for (let i = 0; i < 10; i++) await decodeAudioWaveformChannels(`bounded-${i}.wav`, 3, 1, 1);
const beforeEvicted = reads;
await decodeAudioWaveformChannels("bounded-0.wav", 3, 1, 1);
assert.equal(reads, beforeEvicted + 1, "The waveform cache evicts old entries rather than growing indefinitely");
await decodeAudioWaveformChannels("bounded-9.wav", 3, 1, 1);
assert.equal(reads, beforeEvicted + 1, "Recently decoded waveforms remain cached");
assert.equal(decodes, closes, "AudioContexts close on success, oversized PCM and decoder failures");
console.log("Waveform checks passed: native buffer ownership/subviews, peak detail, cache bounds, cancellation, PCM limits and decoder cleanup.");
