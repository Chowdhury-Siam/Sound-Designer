<script lang="ts">
  import type { Snippet } from "svelte";
  import type { AudioProcessingSettings, SoundFile } from "../types";
  import { formatDuration } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";

  let {
    sound, playing, progress, loop, processing, processingBusy, busy, segmentDuration, effectsOpen, waveform,
    onPrevious, onTogglePlay, onNext, onStop, onLoop, onToggleEffects, onInsert, onRemove,
  }: {
    sound: SoundFile | null;
    waveform: Snippet;
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
    processing.normalize,
    processing.echoMix,
    processing.reverbMix,
    Math.abs(processing.gainDb) >= 0.01,
    Math.abs(processing.pitchSemitones) >= 0.01,
    Math.abs(processing.speed - 1) >= 0.001,
  ].filter(Boolean).length);
  let processedDuration = $derived((segmentDuration > 0 ? segmentDuration : sound?.duration || 0) / (processing.bypass ? 1 : processing.speed) + (processing.bypass ? 0 : processing.echoMix ? 0.9 : processing.reverbMix ? 0.32 : 0));
</script>

<footer class="transport-bar player-dock" class:has-sound={Boolean(sound)}>
  <div class="now-playing">
    <span class="now-glyph"><Icon name="waveform" /></span>
    <div><span class="eyebrow">{playing ? "Playing" : "Preview"}</span><strong class="tooltip" data-tooltip={sound?.name || "Select a sound"}>{sound ? sound.name : "Select a sound"}</strong></div>
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
      {#if processingBusy}<span class="spinner"></span>{:else}<span class="fx-mark">FX</span>{/if}
      {#if processingCount > 0}<i class="fx-active-dot" class:is-bypassed={processing.bypass}></i>{/if}
    </button>
  </div>
  <div class="player-waveform">{@render waveform()}</div>
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
