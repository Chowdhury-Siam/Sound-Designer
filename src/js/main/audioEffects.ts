import type { AudioNormalization, AudioProcessingSettings } from "./types";

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingSettings = {
  bypass: false,
  normalize: false,
  echoMix: 0,
  reverbMix: 0,
  reverse: false,
  gainDb: 0,
  pitchSemitones: 0,
  speed: 1,
  preservePitch: true,
};

export type RenderedAudio = {
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  duration: number;
  gainDb: number;
};

const TARGET_PEAK = Math.pow(10, -1 / 20);
const RENDER_BUDGET_MS = 6;
const CHECK_INTERVAL = 4096;

export const normalizeTargetDb = (value: unknown = -1): number => {
  const target = Number(value);
  return Math.round(Math.max(-24, Math.min(0, Number.isFinite(target) ? target : -1)) * 2) / 2;
};

export const audioNormalizationKey = (normalization: AudioNormalization, targetDb = -1): string =>
  normalization === "manual" ? `manual:${normalizeTargetDb(targetDb)}` : normalization;

export const normalizeAudioProcessing = (value?: Partial<AudioProcessingSettings> | null): AudioProcessingSettings => ({
  bypass: value?.bypass === true,
  normalize: value?.normalize === true,
  echoMix: Math.round(Math.max(0, Math.min(0.6, Number(value?.echoMix) || 0)) * 100) / 100,
  reverbMix: Math.round(Math.max(0, Math.min(0.6, Number(value?.reverbMix) || 0)) * 100) / 100,
  reverse: Boolean(value?.reverse),
  gainDb: Math.round(Math.max(-48, Math.min(12, Number(value?.gainDb) || 0)) * 2) / 2,
  pitchSemitones: Math.round(Math.max(-12, Math.min(12, Number(value?.pitchSemitones) || 0)) * 2) / 2,
  speed: Math.round(Math.max(0.5, Math.min(2, Number(value?.speed) || 1)) * 20) / 20,
  preservePitch: value?.preservePitch !== false,
});

export const audioProcessingKey = (value?: Partial<AudioProcessingSettings> | null): string => {
  const settings = normalizeAudioProcessing(value);
  if (settings.bypass) return audioProcessingKey(DEFAULT_AUDIO_PROCESSING);
  const pitchLock = Math.abs(settings.speed - 1) < 0.001 || settings.preservePitch;
  return [settings.reverse ? 1 : 0, settings.gainDb, settings.pitchSemitones, settings.speed, pitchLock ? 1 : 0, settings.normalize ? 1 : 0, settings.echoMix, settings.reverbMix].join(":");
};

export const hasAudioProcessing = (value?: Partial<AudioProcessingSettings> | null) => audioProcessingKey(value) !== audioProcessingKey(DEFAULT_AUDIO_PROCESSING);

const abortIfNeeded = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException("Audio processing was cancelled.", "AbortError");
};

const createPanelYield = (signal?: AbortSignal) => {
  let sliceStartedAt = performance.now();
  return async (force = false) => {
    abortIfNeeded(signal);
    if (!force && performance.now() - sliceStartedAt < RENDER_BUDGET_MS) return;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    sliceStartedAt = performance.now();
    abortIfNeeded(signal);
  };
};

const resampleChannels = async (
  channels: Float32Array[],
  factor: number,
  signal?: AbortSignal,
) => {
  if (Math.abs(factor - 1) < 0.0001) return channels.map((channel) => channel.slice());
  const outputLength = Math.max(1, Math.round(channels[0].length / factor));
  const output = channels.map(() => new Float32Array(outputLength));
  const yieldToPanel = createPanelYield(signal);
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = Math.min(channels[0].length - 1, index * factor);
    const left = Math.floor(sourcePosition);
    const right = Math.min(channels[0].length - 1, left + 1);
    const mix = sourcePosition - left;
    for (let channel = 0; channel < channels.length; channel += 1) {
      output[channel][index] = channels[channel][left] * (1 - mix) + channels[channel][right] * mix;
    }
    if (index > 0 && index % CHECK_INTERVAL === 0) await yieldToPanel();
  }
  return output;
};

// Waveform-similarity overlap-add keeps transients aligned while stretching.
// A shared match from channel one is applied to every channel to preserve stereo.
const stretchChannels = async (
  channels: Float32Array[],
  outputLength: number,
  sampleRate: number,
  signal?: AbortSignal,
) => {
  const inputLength = channels[0].length;
  if (outputLength <= 1) return channels.map((channel) => channel.slice(0, 1));
  if (Math.abs(outputLength / inputLength - 1) < 0.006) {
    return inputLength === outputLength ? channels.map((channel) => channel.slice()) : resampleChannels(channels, inputLength / outputLength, signal);
  }

  const frameSize = Math.max(256, Math.min(2048, Math.round(sampleRate * 0.042)));
  const overlap = Math.floor(frameSize / 2);
  const synthesisHop = frameSize - overlap;
  const stretch = outputLength / inputLength;
  const analysisHop = synthesisHop / stretch;
  const searchRadius = Math.max(32, Math.min(384, Math.round(sampleRate * 0.006)));
  const searchStep = 8;
  const correlationStep = 8;
  const output = channels.map(() => new Float32Array(outputLength));
  const reference = channels[0];
  const yieldToPanel = createPanelYield(signal);

  const firstCopy = Math.min(frameSize, inputLength, outputLength);
  for (let channel = 0; channel < channels.length; channel += 1) output[channel].set(channels[channel].subarray(0, firstCopy));

  let synthesisPosition = synthesisHop;
  let frameIndex = 1;
  while (synthesisPosition < outputLength) {
    const maximumInputStart = Math.max(0, inputLength - frameSize);
    const expected = Math.max(0, Math.min(maximumInputStart, Math.round(frameIndex * analysisHop)));
    const searchStart = Math.max(0, expected - searchRadius);
    const searchEnd = Math.min(maximumInputStart, expected + searchRadius);
    const compareLength = Math.min(overlap, outputLength - synthesisPosition);
    let bestPosition = expected;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let candidate = searchStart; candidate <= searchEnd; candidate += searchStep) {
      let error = 0;
      let energy = 0.000001;
      for (let index = 0; index < compareLength; index += correlationStep) {
        const existing = output[0][synthesisPosition + index];
        const incoming = reference[candidate + index] || 0;
        const difference = existing - incoming;
        error += difference * difference;
        energy += existing * existing + incoming * incoming;
      }
      const score = error / energy;
      if (score < bestScore) {
        bestScore = score;
        bestPosition = candidate;
      }
    }

    const copyLength = Math.min(frameSize, inputLength - bestPosition, outputLength - synthesisPosition);
    const blendLength = Math.min(overlap, copyLength);
    for (let channel = 0; channel < channels.length; channel += 1) {
      const source = channels[channel];
      const destination = output[channel];
      for (let index = 0; index < blendLength; index += 1) {
        const mix = (index + 1) / (blendLength + 1);
        destination[synthesisPosition + index] = destination[synthesisPosition + index] * (1 - mix) + source[bestPosition + index] * mix;
      }
      for (let index = blendLength; index < copyLength; index += 1) destination[synthesisPosition + index] = source[bestPosition + index];
    }

    synthesisPosition += synthesisHop;
    frameIndex += 1;
    if (frameIndex % 8 === 0) await yieldToPanel();
  }
  return output;
};

export const renderAudioProcessing = async (
  audioBuffer: AudioBuffer,
  processing?: Partial<AudioProcessingSettings> | null,
  normalization: AudioNormalization = "preserve",
  signal?: AbortSignal,
  frameStart = 0,
  frameEnd = audioBuffer.length,
  normalizationTargetDb = -1,
): Promise<RenderedAudio> => {
  abortIfNeeded(signal);
  const settings = normalizeAudioProcessing(processing?.bypass ? DEFAULT_AUDIO_PROCESSING : processing);
  const boundedStart = Math.max(0, Math.min(audioBuffer.length - 1, Math.floor(frameStart)));
  const boundedEnd = Math.max(boundedStart + 1, Math.min(audioBuffer.length, Math.ceil(frameEnd)));
  const sourceLength = boundedEnd - boundedStart;
  let channels: Float32Array[] = [];
  const yieldToPanel = createPanelYield(signal);

  for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
    const source = audioBuffer.getChannelData(channelIndex);
    const channel = new Float32Array(sourceLength);
    if (settings.reverse) {
      for (let index = 0; index < sourceLength; index += 1) {
        channel[index] = source[boundedEnd - index - 1];
        if (index > 0 && index % CHECK_INTERVAL === 0) await yieldToPanel();
      }
    } else channel.set(source.subarray(boundedStart, boundedEnd));
    channels.push(channel);
  }

  const userPitch = Math.pow(2, settings.pitchSemitones / 12);
  const effectivePitch = userPitch * (settings.preservePitch ? 1 : settings.speed);
  const targetLength = Math.max(1, Math.round(sourceLength / settings.speed));
  if (Math.abs(effectivePitch - 1) > 0.0001) channels = await resampleChannels(channels, effectivePitch, signal);
  if (channels[0].length !== targetLength) channels = await stretchChannels(channels, targetLength, audioBuffer.sampleRate, signal);

  // Deterministic delay taps: the same render path is used for audition and
  // imported PCM, with bounded tails and cooperative cancellation.
  const echo = settings.echoMix || 0;
  const reverb = settings.reverbMix || 0;
  if (echo || reverb) {
    const tail = Math.round(audioBuffer.sampleRate * (echo ? 0.9 : 0.32));
    const dryLength = channels[0].length;
    const effected = channels.map(() => new Float32Array(dryLength + tail));
    const taps = [
      ...(echo ? [[0.3, echo], [0.6, echo * 0.45], [0.9, echo * 0.2]] : []),
      ...(reverb ? [[0.031, reverb * 0.5], [0.047, reverb * 0.4], [0.071, reverb * 0.3], [0.113, reverb * 0.24], [0.173, reverb * 0.18], [0.251, reverb * 0.12], [0.32, reverb * 0.06]] : []),
    ].map(([seconds, gain]) => [Math.round(seconds * audioBuffer.sampleRate), gain]);
    for (let c = 0; c < channels.length; c += 1) {
      effected[c].set(channels[c]);
      for (const [delay, amount] of taps) {
        for (let i = 0; i < dryLength; i += 1) {
          effected[c][i + delay] += channels[c][i] * amount;
          if (i % CHECK_INTERVAL === 0) await yieldToPanel();
        }
      }
    }
    channels = effected;
  }
  let peak = 0;
  const normalizing = settings.normalize || normalization !== "preserve";
  if (normalizing) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const channel = channels[channelIndex];
      for (let index = 0; index < channel.length; index += 1) {
        peak = Math.max(peak, Math.abs(channel[index]));
        if (index > 0 && index % CHECK_INTERVAL === 0) await yieldToPanel();
      }
    }
  }
  const targetPeak = normalization === "manual" ? Math.pow(10, normalizeTargetDb(normalizationTargetDb) / 20) : TARGET_PEAK;
  const normalizationGain = normalizing && peak > 0 ? targetPeak / peak : 1;
  const userGain = Math.pow(10, settings.gainDb / 20);
  const gain = normalizationGain * userGain;
  if (Math.abs(gain - 1) > 0.000001 || echo || reverb) {
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const channel = channels[channelIndex];
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = Math.max(-1, Math.min(1, channel[index] * gain));
        if (index > 0 && index % CHECK_INTERVAL === 0) await yieldToPanel();
      }
    }
  }

  const gainDb = gain > 0 ? 20 * Math.log(gain) / Math.LN10 : 0;
  return {
    channels,
    sampleRate: audioBuffer.sampleRate,
    length: channels[0].length,
    duration: channels[0].length / audioBuffer.sampleRate,
    gainDb,
  };
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
};

export const encodeRenderedWave = async (
  rendered: RenderedAudio,
  bitDepth: 16 | 24,
  signal?: AbortSignal,
) => {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = rendered.channels.length * bytesPerSample;
  const dataLength = rendered.length * blockAlign;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, rendered.channels.length, true);
  view.setUint32(24, rendered.sampleRate, true);
  view.setUint32(28, rendered.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  const yieldToPanel = createPanelYield(signal);
  let offset = 44;
  for (let frame = 0; frame < rendered.length; frame += 1) {
    for (let channel = 0; channel < rendered.channels.length; channel += 1) {
      const sample = Math.max(-1, Math.min(1, rendered.channels[channel][frame]));
      if (bitDepth === 16) {
        const integer = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
        view.setInt16(offset, integer, true);
        offset += 2;
      } else {
        let integer = sample < 0 ? Math.round(sample * 0x800000) : Math.round(sample * 0x7fffff);
        if (integer < 0) integer += 0x1000000;
        bytes[offset++] = integer & 0xff;
        bytes[offset++] = (integer >>> 8) & 0xff;
        bytes[offset++] = (integer >>> 16) & 0xff;
      }
    }
    if (frame > 0 && frame % CHECK_INTERVAL === 0) await yieldToPanel();
  }
  return bytes;
};
