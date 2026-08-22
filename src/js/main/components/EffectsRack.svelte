<script lang="ts">
  import type { AudioProcessingSettings, SoundFile } from "../types";
  import { formatDuration } from "../ui-utils";
  import Icon from "./Icon.svelte";

  let {
    sound, processing, processingBusy, processingError, segmentDuration,
    onProcessing, onReset, onClose,
  }: {
    sound: SoundFile | null;
    processing: AudioProcessingSettings;
    processingBusy: boolean;
    processingError: string;
    segmentDuration: number;
    onProcessing: (patch: Partial<AudioProcessingSettings>) => void;
    onReset: () => void;
    onClose: () => void;
  } = $props();

  let processingCount = $derived([
    processing.reverse,
    Math.abs(processing.gainDb) >= 0.01,
    Math.abs(processing.pitchSemitones) >= 0.01,
    Math.abs(processing.speed - 1) >= 0.001,
  ].filter(Boolean).length);
  let processedDuration = $derived((segmentDuration > 0 ? segmentDuration : sound?.duration || 0) / processing.speed);
  let rackWidth = $state(0);
  let rackHeight = $state(0);
  let compactRack = $derived(rackHeight > 0 && rackHeight <= 190);
  let narrowRack = $derived(rackWidth > 0 && rackWidth < 270);
  let tightRack = $derived(rackHeight > 0 && rackHeight < 120);
  const changeProcessing = (patch: Partial<AudioProcessingSettings>) => onProcessing(patch);
</script>

<section
  aria-labelledby="audio-effects-title"
  bind:clientHeight={rackHeight}
  bind:clientWidth={rackWidth}
  class:is-compact={compactRack}
  class:is-narrow={narrowRack}
  class:is-tight={tightRack}
  class="effects-rack"
  id="audio-effects-rack"
>
  <div class="effects-heading">
    <div class="effects-heading-title">
      <span class="effects-heading-icon"><Icon name="sliders" size={15} /></span>
      <div><span class="eyebrow">Sound shaping</span><strong id="audio-effects-title">Effects rack</strong></div>
    </div>
    <span class="effects-scope">{segmentDuration > 0 ? "Selection" : "Full sound"}</span>
    <button class="effects-reset" disabled={!processingCount} onclick={onReset} type="button">Reset</button>
    <button aria-label="Close effects rack" class="effects-close tooltip" data-tooltip="Close effects" onclick={onClose} type="button"><Icon name="close" size={13} /></button>
  </div>

  <div class="effects-rack-body">
    <div class="effects-parameter-group">
      <div class="effect-control">
        <span><Icon name="volume" size={14} /> Gain</span>
        <input aria-label="Gain in decibels" max="12" min="-24" oninput={(event) => changeProcessing({ gainDb: Number(event.currentTarget.value) })} step="0.5" type="range" value={processing.gainDb} />
        <output>{processing.gainDb > 0 ? "+" : ""}{processing.gainDb.toFixed(1)} dB</output>
      </div>
      <div class="effect-control">
        <span><Icon name="waveform" size={14} /> Pitch</span>
        <input aria-label="Pitch shift in semitones" max="12" min="-12" oninput={(event) => changeProcessing({ pitchSemitones: Number(event.currentTarget.value) })} step="0.5" type="range" value={processing.pitchSemitones} />
        <output>{processing.pitchSemitones > 0 ? "+" : ""}{processing.pitchSemitones.toFixed(1)} st</output>
      </div>
      <div class="effect-control effect-control--speed">
        <span><Icon name="activity" size={14} /> Speed</span>
        <input aria-label="Playback and import speed" max="2" min="0.5" oninput={(event) => changeProcessing({ speed: Number(event.currentTarget.value) })} step="0.05" type="range" value={processing.speed} />
        <output>{processing.speed.toFixed(2)}×</output>
        <button
          aria-label={processing.preservePitch ? "Unlock pitch from speed" : "Lock pitch while changing speed"}
          aria-pressed={processing.preservePitch}
          class:active={processing.preservePitch}
          class="pitch-lock-mini tooltip"
          data-tooltip={processing.preservePitch ? "Pitch locked · click to unlock" : "Pitch follows speed · click to lock"}
          onclick={() => changeProcessing({ preservePitch: !processing.preservePitch })}
          type="button"
        ><Icon name={processing.preservePitch ? "lock" : "unlock"} size={11} /></button>
      </div>
    </div>
  </div>

  <div class="effects-summary">
    <span>Output · {formatDuration(processedDuration)}</span>
    {#if processingBusy}<span><i class="spinner"></i> Updating preview</span>{:else if processingError}<span class="effects-error">Preview unavailable · import works</span>{:else}<span class="effects-ready"><i></i> Live preview</span>{/if}
  </div>
</section>
