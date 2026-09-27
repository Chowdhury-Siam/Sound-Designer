<script lang="ts">
  import { onMount, tick, type Snippet } from "svelte";
  import Icon, { type IconName } from "./Icon.svelte";
  let { label, icon, caption = "", children }: { label: string; icon: IconName; caption?: string; children: Snippet } = $props();
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let panel = $state<HTMLDivElement>();
  let open = $state(false);
  let x = $state(8);
  let y = $state(8);
  function overlayLayer(node: HTMLDivElement) {
    (root.closest(".app-shell") || document.body).appendChild(node);
    return { destroy: () => node.remove() };
  }
  async function toggle() {
    open = !open;
    if (!open) return;
    await tick();
    const anchor = trigger.getBoundingClientRect();
    if (!panel) return;
    const bounds = panel.getBoundingClientRect();
    x = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
    const below = anchor.bottom + 6;
    y = Math.max(8, Math.min(below + bounds.height <= window.innerHeight - 8 ? below : anchor.top - bounds.height - 6, window.innerHeight - bounds.height - 8));
  }
  onMount(() => {
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node) && !panel?.contains(event.target as Node)) open = false; };
    const escape = (event: KeyboardEvent) => { if (open && event.key === "Escape") { open = false; trigger.focus(); } };
    const close = () => open = false;
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", close);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); window.removeEventListener("resize", close); };
  });
</script>

<div bind:this={root} class="toolbar-popover">
  <button bind:this={trigger} class="toolbar-popover-trigger tooltip" class:is-active={open} aria-label={label} aria-expanded={open} data-tooltip={label} onclick={toggle} type="button">
    <Icon name={icon} size={14} />
    {#if caption}<span>{caption}</span>{/if}
  </button>
  {#if open}
    <div bind:this={panel} use:overlayLayer class="toolbar-popover-panel" role="group" aria-label={label} style:left={`${x}px`} style:top={`${y}px`}>
      {@render children()}
    </div>
  {/if}
</div>
