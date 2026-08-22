<script lang="ts">
  import { onDestroy } from "svelte";
  import type { AudioPreparationStatus, SoundFile } from "../types";
  import { formatDuration, formatSize } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import Waveform from "./Waveform.svelte";

  let { sound, channels = [], selected, playing, progress, preparation, dragHint, onSelect, onPlay, onInsert, onFavorite, onDragPrepare, onDragStart, onDragEnd }: {
    sound: SoundFile;
    channels?: Float32Array[];
    selected: boolean;
    playing: boolean;
    progress: number;
    preparation?: AudioPreparationStatus;
    dragHint: string;
    onSelect: () => void;
    onPlay: () => void;
    onInsert: () => void;
    onFavorite: () => void;
    onDragPrepare: () => void;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: (event: DragEvent) => void;
  } = $props();

  let score = $derived(76 + (sound.name.length * 7) % 23);
  let isCloud = $derived(sound.source === "freesound");
  let isPreparing = $derived(Boolean(preparation));
  let preparationProgress = $derived(preparation?.progress === undefined
    ? 0.26
    : Math.max(0, Math.min(1, preparation.progress)));
  let preparationLabel = $derived(preparation
    ? preparation.progress === undefined
      ? preparation.message
      : `${preparation.message} ${Math.round(preparation.progress * 100)}%`
    : "");
  let sourceLabel = $derived(isCloud
    ? sound.path ? "Freesound · downloaded for this project" : "Freesound cloud library"
    : "Local sound library");
  let dragPrepareTimer = 0;

  const requestDragPreparation = () => {
    if (dragPrepareTimer) window.clearTimeout(dragPrepareTimer);
    dragPrepareTimer = 0;
    onDragPrepare();
  };

  const scheduleDragPreparation = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (dragPrepareTimer) window.clearTimeout(dragPrepareTimer);
    // A normal selection click should not start a download or conversion. A
    // short hold gives preparation a head start; dragstart always begins it.
    dragPrepareTimer = window.setTimeout(requestDragPreparation, 120);
  };

  const cancelScheduledDragPreparation = () => {
    if (dragPrepareTimer) window.clearTimeout(dragPrepareTimer);
    dragPrepareTimer = 0;
  };

  onDestroy(cancelScheduledDragPreparation);
</script>

<div
  class={`sound-row accent-${sound.accent} ${selected ? "is-selected" : ""}`}
  class:is-cloud={isCloud}
  class:is-preparing={isPreparing}
  draggable={Boolean(sound.path) || isCloud}
  onclick={onSelect}
  ondblclick={onInsert}
  onpointerdown={scheduleDragPreparation}
  onpointerup={cancelScheduledDragPreparation}
  onpointercancel={cancelScheduledDragPreparation}
  ondragstart={(event) => { requestDragPreparation(); onDragStart(event); }}
  ondragend={(event) => { cancelScheduledDragPreparation(); onDragEnd(event); }}
  onkeydown={(event) => {
    if (event.key === "Enter") onSelect();
  }}
  role="option"
  aria-selected={selected}
  aria-busy={isPreparing}
  tabindex="0"
>
  <span class="drag-handle tooltip" data-tooltip={dragHint}><Icon name="drag" /></span>
  <button aria-label={playing ? `Pause ${sound.name}` : `Preview ${sound.name}`} class="row-play tooltip" data-tooltip={playing ? "Pause preview" : "Preview sound"} onclick={(event) => { event.stopPropagation(); onPlay(); }} type="button">
    <Icon name={playing ? "pause" : "play"} size={14} />
  </button>
  <div class="sound-main">
    <div class="sound-title-line">
      <span
        aria-label={isPreparing ? preparationLabel : sourceLabel}
        class={`sound-source sound-source--${isCloud ? "cloud" : "local"} ${sound.downloadState === "error" ? "sound-source--error" : ""} tooltip`}
        data-tooltip={isPreparing ? preparationLabel : sourceLabel}
      >
        {#if isPreparing}
          <svg
            aria-hidden="true"
            class:progress-ring--indeterminate={preparation?.progress === undefined}
            class="progress-ring"
            viewBox="0 0 16 16"
          >
            <circle class="progress-ring__track" cx="8" cy="8" r="5.25"></circle>
            <circle
              class="progress-ring__value"
              cx="8"
              cy="8"
              r="5.25"
              style:stroke-dashoffset={`${32.99 * (1 - preparationProgress)}`}
            ></circle>
          </svg>
        {:else}
          <Icon name={isCloud ? sound.path ? "cloudCheck" : "cloud" : "drive"} size={13} />
        {/if}
      </span>
      <strong>{sound.name}</strong>
      {#if isCloud && sound.creator}<small class="sound-creator">by {sound.creator}</small>{/if}
    </div>
    <Waveform compact values={sound.waveform} {channels} progress={playing ? progress : 0} />
  </div>
  <div class="sound-meta"><span>{sound.duration ? formatDuration(sound.duration) : "—:—"}</span><small>{sound.extension.toUpperCase()} · {formatSize(sound.size)}</small></div>
  <span class="match-score tooltip" data-tooltip="Search relevance">{score}%</span>
  <IconButton icon="heart" label={sound.favorite ? "Remove from favorites" : "Add to favorites"} active={sound.favorite} onclick={(event) => { event.stopPropagation(); onFavorite(); }} class="row-favorite" />
</div>
