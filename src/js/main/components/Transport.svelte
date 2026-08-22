<script lang="ts">
  import type { AudioProcessingSettings, SoundFile } from "../types";
  import { formatDuration } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  let {
    sound, playing, progress, loop, processing, processingBusy, busy, segmentDuration, effectsOpen,
    onPrevious, onTogglePlay, onNext, onStop, onLoop, onToggleEffects, onInsert, onRemove,
  }: {
    sound: SoundFile | null;
    playing: boolean;
    progress: number;
    loop: boolean;
    processing: AudioProcessingSettings;
    processingBusy: boolean;
    busy: boolean;
    segmentDuration: number;
    effectsOpen: boolean;
    onPrevious: () => void;
    onTogglePlay: () => void;
    onNext: () => void;
    onStop: () => void;
    onLoop: () => void;
    onToggleEffects: () => void;
    onInsert: () => void;
    onRemove: () => void;
  } = $props();

  let processingCount = $derived([
    processing.reverse,
    Math.abs(processing.gainDb) >= 0.01,
    Math.abs(processing.pitchSemitones) >= 0.01,
    Math.abs(processing.speed - 1) >= 0.001,
  ].filter(Boolean).length);
  let processedDuration = $derived((segmentDuration > 0 ? segmentDuration : sound?.duration || 0) / processing.speed);
</script>

<footer class="transport-bar">
  <div class="now-playing">
    <span class="now-glyph"><Icon name="waveform" /></span>
    <div><span class="eyebrow">Now previewing</span><strong>{sound ? sound.name : "Select a sound"}</strong></div>
  </div>
  <div class="transport-controls">
    <IconButton icon="previous" label="Previous sound" onclick={onPrevious} disabled={!sound} />
    <button aria-label={playing ? "Pause preview" : "Play preview"} class="play-button tooltip" data-tooltip={playing ? "Pause preview" : "Play preview"} disabled={!sound} onclick={onTogglePlay} type="button">
      <Icon name={playing ? "pause" : "play"} size={18} />
    </button>
    <IconButton icon="next" label="Next sound" onclick={onNext} disabled={!sound} />
    <IconButton icon="stop" label="Stop and return to start" onclick={onStop} disabled={!sound} />
    <IconButton icon="loop" label="Loop preview" active={loop} pressed={loop} onclick={onLoop} />
    <button aria-controls="audio-effects-rack" aria-expanded={effectsOpen} aria-label={processingCount ? `Audio effects, ${processingCount} active` : "Audio effects"} class:active={effectsOpen || processingCount > 0} class="effects-button tooltip" data-tooltip="Audio effects" disabled={!sound} onclick={onToggleEffects} type="button">
      <span class="effects-button-icon">{#if processingBusy}<span class="spinner"></span>{:else}<Icon name="sliders" size={14} />{/if}</span>
      <span class="effects-button-copy"><strong>FX</strong><small>{processingCount ? `${processingCount} active` : "Effects"}</small></span>
      <span class:open={effectsOpen} class="effects-button-arrow"><Icon name="chevron" size={10} /></span>
    </button>
  </div>
  <div class="transport-right">
    <span class="transport-time">{sound ? formatDuration(progress * (sound.duration || 0)) : "0:00"}{#if segmentDuration > 0}<small> / {formatDuration(processedDuration)} output</small>{/if}</span>
    <IconButton icon="trash" label="Remove from index (keeps source file)" onclick={onRemove} disabled={!sound} class="danger-icon" />
    <button class="primary-button tooltip" data-tooltip={segmentDuration > 0 ? "Insert selected audio segment with active effects" : "Insert at the current playhead with active effects"} disabled={!sound || busy || processingBusy} onclick={onInsert} type="button">
      {#if busy}<span class="spinner"></span>{:else}<Icon name="download" />{/if}
      <span class="insert-label-full">{segmentDuration > 0 ? "Insert segment" : "Insert"}</span>
      <span class="insert-label-compact">Insert</span>
    </button>
  </div>
</footer>
