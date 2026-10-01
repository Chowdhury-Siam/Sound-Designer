<script lang="ts">
  import type { SoundFile } from "../types";
  import type { FavoriteCollection } from "../libraryMetadata";
  import IconButton from "./IconButton.svelte";
  let { sound, collections, onSave, onCreate, onClose }: {
    sound: SoundFile | null; collections: FavoriteCollection[];
    onSave: (sound: SoundFile, collection: string, favorite: boolean) => void;
    onCreate: (name: string, parent: string) => string;
    onClose: () => void;
  } = $props();
  let destination = $state("");
  let name = $state("");
  let dialog = $state<HTMLDivElement | null>(null);
  const collectionPath = (item: FavoriteCollection) => {
    const parts = [item.name]; const seen = new Set([item.id]); let parent = item.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent); const node = collections.find(c => c.id === parent); if (!node) break;
      parts.unshift(node.name); parent = node.parentId;
    }
    return parts.join(" / ");
  };
  $effect(() => { if (sound) { destination = sound.favoriteCollection || ""; name = ""; } });
  $effect(() => {
    if (!sound || !dialog) return;
    const element = dialog;
    const previous = document.activeElement as HTMLElement;
    const background = Array.from(document.querySelectorAll<HTMLElement>(".topbar, .panel-body, .transport-bar"));
    const previousAriaHidden = background.map((element) => element.getAttribute("aria-hidden"));
    background.forEach((element) => element.setAttribute("aria-hidden", "true"));
    const controls = () => Array.from(element.querySelectorAll<HTMLElement>("button:not([disabled]),input,select"));
    controls()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
      if (e.key === "Tab") {
        const list = controls(); const first = list[0]; const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      background.forEach((element, index) => {
        const value = previousAriaHidden[index];
        if (value === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", value);
      });
      previous?.focus();
    };
  });
</script>

{#if sound}
  <div class="sheet-scrim favorite-scrim" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div bind:this={dialog} class="bottom-sheet favorite-sheet" role="dialog" aria-modal="true" aria-labelledby="favorite-title" tabindex="-1">
      <header class="sheet-heading"><div class="favorite-heading-copy"><span class="eyebrow">Favorites</span><strong id="favorite-title">{sound.name}</strong></div><IconButton icon="close" label="Close favorites" onclick={onClose} /></header>
      <div class="favorite-sheet-body">
        <label class="favorite-field">Save to<select aria-label="Favorite destination" bind:value={destination}><option value="">Main Favorites</option>{#each collections as item (item.id)}<option value={item.id}>{collectionPath(item)}</option>{/each}</select></label>
        <div class="favorite-field">
          <label for="favorite-subfolder">New subfolder</label>
          <div class="favorite-create-row">
            <input aria-describedby="favorite-storage-note" id="favorite-subfolder" maxlength="60" placeholder="Collection name…" bind:value={name} />
            <button aria-label="Create subfolder inside selected destination" class="ghost-button" disabled={!name.trim()} onclick={() => { const id = onCreate(name, destination); if (id) { destination = id; name = ""; } }} type="button">Create folder</button>
          </div>
        </div>
        <small class="favorite-storage-note" id="favorite-storage-note">Collections save references only. Original audio files stay exactly where they are.</small>
      </div>
      <footer class="sheet-footer">
        {#if sound.favorite}<button class="danger-ghost" onclick={() => onSave(sound!, "", false)} type="button">Unfavorite</button>{/if}
        <span class="topbar-spacer"></span><button class="ghost-button" onclick={onClose} type="button">Cancel</button><button class="primary-button" onclick={() => onSave(sound!, destination, true)} type="button">{sound.favorite ? "Move favorite" : "Add favorite"}</button>
      </footer>
    </div>
  </div>
{/if}
