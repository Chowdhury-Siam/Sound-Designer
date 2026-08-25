<script lang="ts">
  import { onDestroy } from "svelte";
  import { LABEL_COLORS, labelColorName, labelColorValue } from "../labels";
  import type { LabelColor } from "../types";

  let {
    color,
    label = "Color label",
    onChange,
    showEmpty = true,
  }: {
    color?: LabelColor;
    label?: string;
    onChange: (color?: LabelColor) => void;
    showEmpty?: boolean;
  } = $props();
  let open = $state(false);
  let root: HTMLDivElement | null = null;
  let trigger: HTMLButtonElement | null = null;
  let popoverX = $state(0);
  let popoverY = $state(0);

  const togglePicker = (event: MouseEvent) => {
    event.stopPropagation();
    if (!open && trigger) {
      const rect = trigger.getBoundingClientRect();
      popoverX = Math.max(8, Math.min(window.innerWidth - 220, rect.left - 78));
      popoverY = rect.bottom + 8 + 42 > window.innerHeight ? rect.top - 42 : rect.bottom + 8;
    }
    open = !open;
  };

  const closeOutside = (event: PointerEvent) => {
    if (root && event.target instanceof Node && !root.contains(event.target)) open = false;
  };

  $effect(() => {
    if (!open) return;
    document.addEventListener("pointerdown", closeOutside, true);
    return () => document.removeEventListener("pointerdown", closeOutside, true);
  });
  $effect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") open = false; };
    window.addEventListener("keydown", closeOnEscape, true);
    return () => window.removeEventListener("keydown", closeOnEscape, true);
  });
  onDestroy(() => document.removeEventListener("pointerdown", closeOutside, true));
</script>

<div bind:this={root} class="color-label-picker">
  <button
    bind:this={trigger}
    aria-expanded={open}
    aria-label={`${label}: ${labelColorName(color)}`}
    class:has-label={Boolean(color)}
    class="color-label-trigger tooltip"
    data-tooltip={`${label}: ${labelColorName(color)}`}
    onclick={togglePicker}
    type="button"
  ><i style:background={labelColorValue(color)}></i></button>
  {#if open}
    <div aria-label={label} class="color-label-popover" role="group" style:left={`${popoverX}px`} style:top={`${popoverY}px`}>
      {#each LABEL_COLORS as item (item.id)}
        <button aria-label={`Set ${item.label} label`} aria-pressed={color === item.id} class:is-active={color === item.id} onclick={(event) => { event.stopPropagation(); onChange(item.id); open = false; }} type="button"><i style:background={item.value}></i></button>
      {/each}
      {#if showEmpty}<button aria-label="Remove color label" aria-pressed={!color} class:is-active={!color} class="color-label-clear" onclick={(event) => { event.stopPropagation(); onChange(undefined); open = false; }} type="button">×</button>{/if}
    </div>
  {/if}
</div>
