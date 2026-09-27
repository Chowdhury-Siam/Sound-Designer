<script lang="ts">
  import { onMount } from "svelte";
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
    processing.normalize,
    processing.echoMix,
    processing.reverbMix,
    Math.abs(processing.gainDb) >= 0.01,
    Math.abs(processing.pitchSemitones) >= 0.01,
    Math.abs(processing.speed - 1) >= 0.001,
  ].filter(Boolean).length);
  let processedDuration = $derived((segmentDuration > 0 ? segmentDuration : sound?.duration || 0) / (processing.bypass ? 1 : processing.speed));
  let rackElement: HTMLElement;
  let left = $state(8);
  let top = $state(8);
  let maxHeight = $state(300);
  let positioned = $state(false);
  onMount(() => {
    let positionFrame = 0;
    const position = () => {
      const anchor = document.querySelector(".effects-button")?.getBoundingClientRect();
      const dock = document.querySelector(".player-dock")?.getBoundingClientRect();
      const ceiling = document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0;
      const available = (dock?.top || window.innerHeight) - ceiling - 16;
      // Short docks use a viewport-bounded sheet; taller docks keep the player visible.
      maxHeight = available >= 180 ? available : window.innerHeight - 24;
      cancelAnimationFrame(positionFrame);
      positionFrame = requestAnimationFrame(() => {
        if (!rackElement) return;
        const rect = rackElement.getBoundingClientRect();
        left = Math.max(8, Math.min(anchor?.left || 8, window.innerWidth - rect.width - 8));
        top = available >= 180 ? Math.max(8, (dock?.top || window.innerHeight) - rect.height - 8) : Math.max(8, (window.innerHeight - rect.height) / 2);
        positioned = true;
      });
    };
    position();
    const observer = new ResizeObserver(position);
    const dock = document.querySelector(".player-dock");
    if (dock) observer.observe(dock);
    window.addEventListener("resize", position);
    const focusFrame = requestAnimationFrame(() => rackElement?.querySelector<HTMLButtonElement>(".effects-close")?.focus());
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (!rackElement.contains(target) && !target.closest(".effects-button")) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        document.querySelector<HTMLButtonElement>(".effects-button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => { cancelAnimationFrame(positionFrame); cancelAnimationFrame(focusFrame); observer.disconnect(); window.removeEventListener("resize", position); document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
  });
  const changeProcessing = (patch: Partial<AudioProcessingSettings>) => onProcessing(patch);
</script>

<section
  bind:this={rackElement}
  aria-labelledby="audio-effects-title"
  class="effects-rack effects-floating"
  style:left={`${left}px`}
  style:top={`${top}px`}
  style:max-height={`${maxHeight}px`}
  style:visibility={positioned ? "visible" : "hidden"}
  id="audio-effects-rack"
>
  <div class="effects-heading">
    <div class="effects-heading-title">
      <Icon name="sliders" size={14} />
      <strong id="audio-effects-title">Effects</strong>
    </div>
    <span class="effects-scope">{segmentDuration > 0 ? "Selection" : "Full sound"}</span>
    <button class="effects-reset" disabled={!processingCount && !processing.bypass} onclick={onReset} type="button">Reset</button>
    <button aria-label="Close effects rack" class="effects-close tooltip" data-tooltip="Close effects" onclick={onClose} type="button"><Icon name="close" size={13} /></button>
  </div>

  <div class="effects-rack-body">
    <div class="quick-fx-controls">
      <button aria-pressed={processing.bypass === true} onclick={() => changeProcessing({ bypass: !processing.bypass })} type="button">{processing.bypass ? "Enable FX" : "Bypass"}</button>
      <button class:is-active={processing.normalize} aria-pressed={processing.normalize === true} onclick={() => changeProcessing({ normalize: !processing.normalize })} type="button" title="Peak normalize to −1 dBFS before gain">Normalize −1 dB</button>
    </div>
    <div class="effects-parameter-group">
      <label class="effect-control" title="Three-tap 300 ms echo; tail included in import"><span>Echo</span><input aria-label="Echo amount" type="range" min="0" max="0.6" step="0.01" value={processing.echoMix || 0} oninput={(e) => changeProcessing({ echoMix: Number(e.currentTarget.value) })} /><output>{Math.round((processing.echoMix || 0) * 100)}%</output></label>
      <label class="effect-control" title="Short room reflections; tail included in import"><span>Room</span><input aria-label="Room reverb amount" type="range" min="0" max="0.6" step="0.01" value={processing.reverbMix || 0} oninput={(e) => changeProcessing({ reverbMix: Number(e.currentTarget.value) })} /><output>{Math.round((processing.reverbMix || 0) * 100)}%</output></label>
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
    <span>{processing.bypass ? "FX bypassed" : `Rendered audio · ${formatDuration(processedDuration + ((processing.echoMix || 0) > 0 ? 0.9 : (processing.reverbMix || 0) > 0 ? 0.32 : 0))}`}</span>
    {#if processingBusy}<span><i class="spinner"></i> Updating preview</span>{:else if processingError}<span class="effects-error tooltip" data-tooltip={processingError}>Preview unavailable</span>{:else}<span class="effects-ready"><i></i> Live preview</span>{/if}
  </div>
</section>
