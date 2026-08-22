import { encodeRenderedWave, renderAudioProcessing } from "../src/js/main/audioEffects";

(globalThis as typeof globalThis & { window: typeof globalThis }).window = globalThis;

const sampleRate = 8_000;
const samples = new Float32Array(sampleRate);
for (let index = 0; index < samples.length; index += 1) samples[index] = Math.sin(index / sampleRate * Math.PI * 2 * 440) * 0.25;

const audioBuffer = {
  length: samples.length,
  duration: 1,
  numberOfChannels: 1,
  sampleRate,
  getChannelData: () => samples,
} as AudioBuffer;

const assertNear = (actual: number, expected: number, tolerance: number, label: string) => {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${label}: expected ${expected}, received ${actual}`);
};

const estimateFrequency = (channel: Float32Array) => {
  const start = Math.floor(channel.length * 0.12);
  const end = Math.floor(channel.length * 0.88);
  let crossings = 0;
  for (let index = start + 1; index < end; index += 1) {
    if (channel[index - 1] <= 0 && channel[index] > 0) crossings += 1;
  }
  return crossings / ((end - start) / sampleRate);
};

const naturalSpeed = await renderAudioProcessing(audioBuffer, { speed: 2, preservePitch: false });
assertNear(naturalSpeed.duration, 0.5, 0.002, "natural-speed duration");
assertNear(estimateFrequency(naturalSpeed.channels[0]), 880, 18, "natural-speed pitch");

const lockedSpeed = await renderAudioProcessing(audioBuffer, { speed: 2, preservePitch: true });
assertNear(lockedSpeed.duration, 0.5, 0.002, "pitch-locked duration");
assertNear(estimateFrequency(lockedSpeed.channels[0]), 440, 28, "pitch-locked pitch");

const shiftedPitch = await renderAudioProcessing(audioBuffer, { pitchSemitones: 12, speed: 1, preservePitch: true });
assertNear(shiftedPitch.duration, 1, 0.002, "pitch-shift duration");
assertNear(estimateFrequency(shiftedPitch.channels[0]), 880, 40, "pitch-shift frequency");

const impulse = new Float32Array([0.25, 0, 0, 0]);
const impulseBuffer = {
  length: impulse.length,
  duration: impulse.length / sampleRate,
  numberOfChannels: 1,
  sampleRate,
  getChannelData: () => impulse,
} as AudioBuffer;
const reversedGain = await renderAudioProcessing(impulseBuffer, { reverse: true, gainDb: 6 });
assertNear(reversedGain.channels[0][3], 0.25 * Math.pow(10, 6 / 20), 0.0001, "reverse and gain");

const ranged = new Float32Array([1, 0.25, -0.25, 1]);
const rangedBuffer = {
  length: ranged.length,
  duration: ranged.length / sampleRate,
  numberOfChannels: 1,
  sampleRate,
  getChannelData: () => ranged,
} as AudioBuffer;
const normalizedSegment = await renderAudioProcessing(
  rangedBuffer,
  undefined,
  "peak-minus-one",
  undefined,
  1,
  3,
);
assertNear(normalizedSegment.channels[0][0], Math.pow(10, -1 / 20), 0.0001, "segment-only normalization");
assertNear(normalizedSegment.channels[0][1], -Math.pow(10, -1 / 20), 0.0001, "segment-only normalization polarity");

const stereoWave = await encodeRenderedWave({
  channels: [new Float32Array([0, 0.5]), new Float32Array([0, -0.5])],
  sampleRate: 48_000,
  length: 2,
  duration: 2 / 48_000,
  gainDb: 0,
}, 24);
const stereoView = new DataView(stereoWave.buffer, stereoWave.byteOffset, stereoWave.byteLength);
if (stereoWave.byteLength !== 56) throw new Error(`24-bit stereo WAV size: expected 56, received ${stereoWave.byteLength}`);
if (stereoView.getUint16(22, true) !== 2) throw new Error("24-bit WAV channel header is incorrect");
if (stereoView.getUint16(34, true) !== 24) throw new Error("24-bit WAV depth header is incorrect");
if (stereoView.getUint32(40, true) !== 12) throw new Error("24-bit WAV data length is incorrect");

console.log("Audio effects smoke test passed.");
