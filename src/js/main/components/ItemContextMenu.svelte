<script lang="ts">
  import { LABEL_COLORS, displayLabelColor, labelColorName } from "../labels";
  import type { LabelColor } from "../types";
  import Icon from "./Icon.svelte";

  let {
    open,
    x,
    y,
    color,
    pinned = false,
    canPin = false,
    canEdit = false,
    itemName = "item",
    onColor,
    onTogglePinned,
    onEdit,
    onClose,
  }: {
    open: boolean;
    x: number;
    y: number;
    color?: LabelColor;
    pinned?: boolean;
    canPin?: boolean;
    canEdit?: boolean;
    itemName?: string;
    onColor: (color?: LabelColor) => void;
    onTogglePinned?: () => void;
    onEdit?: () => void;
    onClose: () => void;
  } = $props();

  const chooseColor = (nextColor?: LabelColor) => {
    onColor(nextColor);
    onClose();
  };

  const togglePinned = () => {
    onTogglePinned?.();
    onClose();
  };

  const edit = () => {
    onEdit?.();
    onClose();
  };
</script>

<svelte:window onkeydown={(event) => { if (open && event.key === "Escape") onClose(); }} onblur={() => { if (open) onClose(); }} />

{#if open}
  <button aria-label="Close context menu" class="item-context-scrim" onclick={onClose} oncontextmenu={(event) => { event.preventDefault(); onClose(); }} type="button"></button>
  <div
    aria-label={`${itemName} options`}
    class="item-context-menu"
    oncontextmenu={(event) => event.preventDefault()}
    role="menu"
    tabindex="-1"
    style:left={`${x}px`}
    style:top={`${y}px`}
  >
    <span class="item-context-menu__label">Color label · {labelColorName(color)}</span>
    <div aria-label="Color label" class="item-context-colors" role="group">
      {#each LABEL_COLORS as item (item.id)}
        <button
          aria-label={`Set ${item.label} label`}
          aria-pressed={displayLabelColor(color) === item.id}
          class:is-active={displayLabelColor(color) === item.id}
          onclick={() => chooseColor(item.id)}
          title={`${item.label} label`}
          type="button"
        ><i style:background={item.value}></i></button>
      {/each}
    </div>
    {#if color}
      <button class="item-context-action" onclick={() => chooseColor(undefined)} role="menuitem" type="button"><Icon name="close" size={13} /><span>Remove color label</span></button>
    {/if}
    {#if canPin || canEdit}
      <span class="item-context-divider"></span>
    {/if}
    {#if canPin}
      <button class="item-context-action" onclick={togglePinned} role="menuitem" type="button"><Icon name="pin" size={14} /><span>{pinned ? "Unpin from top" : "Pin to top"}</span></button>
    {/if}
    {#if canEdit}
      <button class="item-context-action" onclick={edit} role="menuitem" type="button"><Icon name="more" size={14} /><span>Edit library folder…</span></button>
    {/if}
  </div>
{/if}
