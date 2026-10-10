<script lang="ts">
  import { tick } from "svelte";

  import type { UpdateState } from "../updater";
  import type { LibraryFolder, ScanProgress, SoundFile } from "../types";
  import { folderNameFromPath } from "../library";
  import { compactChain, findTreePath, relativeTime, treeMatchesQuery } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import IconButton from "./IconButton.svelte";
  import ItemContextMenu from "./ItemContextMenu.svelte";
  import LibraryTreeRow from "./LibraryTreeRow.svelte";
  import type { FavoriteCollection } from "../libraryMetadata";

  let {
    collections, favoriteSounds, favoriteSelected, onSelectFavorites,
    cloudLibraryEnabled, onCloudLibraryEnabled,
    folders, sounds, selectedFolder, query, indexing, indexProgress, now,
    localSourceEnabled, freesoundLibraryEnabled, freesoundSourceEnabled, freesoundConnected, freesoundCount,
    onSelectFolder, onQueryChange, onAddFolder, onEditFolder, onRescan, onClose,
    onFolderLabelColor, onToggleFolderPinned,
    onLocalSourceEnabled, onFreesoundSourceEnabled,
    update, updateDismissed, onOpenUpdate, onDismissUpdate,
  }: {
    collections: FavoriteCollection[];
    favoriteSounds: SoundFile[];
    favoriteSelected: string | null;
    onSelectFavorites: (id: string) => void;
    cloudLibraryEnabled: boolean;
    onCloudLibraryEnabled: (enabled: boolean) => void;
    folders: LibraryFolder[];
    sounds: SoundFile[];
    selectedFolder: string;
    query: string;
    indexing: boolean;
    indexProgress: ScanProgress;
    now: number;
    localSourceEnabled: boolean;
    freesoundLibraryEnabled: boolean;
    freesoundSourceEnabled: boolean;
    freesoundConnected: boolean;
    freesoundCount: number;
    onSelectFolder: (folderId: string, keepOpen?: boolean) => void;
    onQueryChange: (value: string) => void;
    onAddFolder: () => void;
    onEditFolder: (folderId: string) => void;
    onFolderLabelColor: (node: LibraryFolder["tree"], color: LibraryFolder["tree"]["labelColor"]) => void;
    onToggleFolderPinned: (node: LibraryFolder["tree"]) => void;
    onRescan: () => void;
    onClose: () => void;
    onLocalSourceEnabled: (enabled: boolean) => void;
    onFreesoundSourceEnabled: (enabled: boolean) => void;
    update: UpdateState;
    updateDismissed: boolean;
    onOpenUpdate: () => void;
    onDismissUpdate: () => void;
  } = $props();

  let expandedIds = $state(new Set<string>());
  let favoritesExpanded = $state(false);
  let expandedCollectionIds = $state(new Set<string>());
  let sidebarElement = $state<HTMLElement | null>(null);
  let revealGeneration = 0;
  let normalizedQuery = $derived(query.trim().toLowerCase());
  let progressLocation = $derived(folderNameFromPath(indexProgress.currentPath));
  let visibleFolders = $derived(folders.filter((folder) => treeMatchesQuery(folder.tree, normalizedQuery)));
  let activeSourceCount = $derived(Number(localSourceEnabled) + Number(cloudLibraryEnabled) + Number(freesoundLibraryEnabled && freesoundSourceEnabled));
  // Keep branch elbows readable; compact the secondary badge before sacrificing hierarchy.
  const maxVisibleDepth = (nodes: LibraryFolder["tree"][], depth: number): number => {
    let max = -1;
    for (const node of nodes) {
      const chain = compactChain(node, normalizedQuery);
      const tail = chain[chain.length - 1];
      max = Math.max(max, depth);
      if (normalizedQuery || expandedIds.has(tail.id)) {
        max = Math.max(max, maxVisibleDepth(tail.children.filter(child => treeMatchesQuery(child, normalizedQuery)), depth + 1));
      }
    }
    return max;
  };
  let branchWidth = $state(0);
  let deepestLevel = $derived(maxVisibleDepth(visibleFolders.map(folder => folder.tree), 0));
  let treeIndent = $derived.by(() => {
    if (deepestLevel <= 0 || !branchWidth) return 16;
    const rowChrome = 66 + (branchWidth < 260 ? 32 : 58);
    const minNameWidth = 56;
    return Math.max(10, Math.min(16, Math.floor((branchWidth - rowChrome - minNameWidth) / deepestLevel)));
  });
  const collectPinned = (foldersToSearch: LibraryFolder[]) => {
    const pinned: LibraryFolder["tree"][] = [];
    for (const folder of foldersToSearch) {
      const pending = [folder.tree];
      while (pending.length) {
        const node = pending.shift();
        if (!node) continue;
        if (node.pinned) pinned.push(node);
        pending.unshift(...node.children);
      }
    }
    return pinned;
  };
  let pinnedFolders = $derived(collectPinned(folders));
  let favoriteCounts = $derived.by(() => {
    const counts = new Map<string, number>();
    const ids = new Set<string>();
    for (const sound of favoriteSounds) {
      ids.add(sound.id);
      const collection = sound.favoriteCollection || "";
      counts.set(collection, (counts.get(collection) || 0) + 1);
    }
    return { total: ids.size, collections: counts };
  });
  let pinnedContextNode = $state<LibraryFolder["tree"] | null>(null);
  let pinnedContextX = $state(0);
  let pinnedContextY = $state(0);
  let orderedCollections = $derived.by(() => {
    const result: { item: FavoriteCollection; depth: number }[] = [];
    const visited = new Set<string>();
    const visit = (parent: string, depth: number) => {
      for (const item of collections.filter(item => item.parentId === parent)) {
        if (visited.has(item.id)) continue;
        visited.add(item.id); result.push({ item, depth });
        if (expandedCollectionIds.has(item.id)) visit(item.id, depth + 1);
      }
    };
    visit("", 0);
    return result;
  });
  const collectionPath = (item: FavoriteCollection) => {
    const parts = [item.name]; const visited = new Set([item.id]); let parent = item.parentId;
    while (parent && !visited.has(parent)) {
      visited.add(parent); const node = collections.find(collection => collection.id === parent); if (!node) break;
      parts.unshift(node.name); parent = node.parentId;
    }
    return `Favorites / ${parts.join(" / ")}`;
  };
  const toggleCollection = (id: string) => {
    const next = new Set(expandedCollectionIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    expandedCollectionIds = next;
  };

  const openPinnedContext = (event: MouseEvent, node: LibraryFolder["tree"]) => {
    event.preventDefault();
    event.stopPropagation();
    pinnedContextNode = node;
    pinnedContextX = Math.max(8, Math.min(window.innerWidth - 220, event.clientX));
    pinnedContextY = Math.max(8, Math.min(window.innerHeight - 220, event.clientY));
  };

  const toggleTreeNode = (nodeId: string) => {
    const next = new Set(expandedIds);
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    expandedIds = next;
  };
  const revealPinnedFolder = async (nodeId: string) => {
    const generation = ++revealGeneration;
    const path = findTreePath(folders.map(folder => folder.tree), nodeId);
    if (!path.length) return;
    onQueryChange("");
    if (!localSourceEnabled) onLocalSourceEnabled(true);
    expandedIds = new Set([...expandedIds, ...path.map(node => node.id)]);
    onSelectFolder(nodeId, true);
    await tick();
    if (generation !== revealGeneration || !sidebarElement?.isConnected) return;
    const row = Array.from(sidebarElement.querySelectorAll<HTMLElement>("[data-library-node]"))
      .find(element => (JSON.parse(element.dataset.libraryNode || "[]") as string[]).includes(nodeId));
    const list = sidebarElement.querySelector<HTMLElement>(".library-list");
    if (!row || !list) return;
    const stickyOffset = (Number(getComputedStyle(row).getPropertyValue("--depth")) || 0) * 29;
    list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - 12 - stickyOffset;
    row.querySelector<HTMLButtonElement>(".library-tree-select")?.focus({ preventScroll: true });
  };
</script>

<aside bind:this={sidebarElement} class="library-panel">
  <div class="panel-heading">
    <div><span class="eyebrow">Library</span><strong>{activeSourceCount} {activeSourceCount === 1 ? "source" : "sources"} active</strong></div>
    <div class="heading-actions">
      <IconButton icon="refresh" label="Rescan all folders" onclick={onRescan} disabled={indexing} class={`rescan-button ${indexing ? "is-loading" : ""}`} />
      <IconButton icon="add" label="Add sound folder" onclick={onAddFolder} />
      <IconButton icon="close" label="Close library drawer" onclick={onClose} class="drawer-close" />
    </div>
  </div>

  <div class="library-list">
    <div class="favorite-library-section">
      <div class="favorite-library-heading">
        <button class="tree-expander tooltip" class:is-expanded={favoritesExpanded} data-tooltip={favoritesExpanded ? "Hide favorite collections" : "Show favorite collections"} aria-label={favoritesExpanded ? "Collapse Favorites collections" : "Expand Favorites collections"} aria-expanded={favoritesExpanded} onclick={() => favoritesExpanded = !favoritesExpanded} type="button"><Icon name="chevron" size={12} /></button>
        <button class:is-selected={favoriteSelected !== null} class="favorite-library-row tooltip" data-tooltip="Favorites across every folder" onclick={() => onSelectFavorites("all")} type="button"><Icon name="heart" size={14} /><span>Favorites</span><small>{favoriteCounts.total}</small></button>
      </div>
      {#if favoritesExpanded}
      <button class:is-selected={favoriteSelected === ""} class="favorite-library-row tooltip" data-tooltip="Favorites without a collection" onclick={() => onSelectFavorites("")} type="button"><Icon name="folder" size={12} /><span>Main Favorites</span><small>{favoriteCounts.collections.get("") || 0}</small></button>
      {#each orderedCollections as { item } (item.id)}
        <div class="favorite-library-heading">
          <button class="tree-expander" class:is-expanded={expandedCollectionIds.has(item.id)} disabled={!collections.some(child => child.parentId === item.id)} aria-label={`${expandedCollectionIds.has(item.id) ? "Collapse" : "Expand"} ${item.name} collection`} aria-expanded={expandedCollectionIds.has(item.id)} onclick={() => toggleCollection(item.id)} type="button"><Icon name="chevron" size={12} /></button>
          <button class:is-selected={favoriteSelected === item.id} class="favorite-library-row tooltip" data-tooltip={collectionPath(item)} onclick={() => onSelectFavorites(item.id)} type="button"><Icon name="folder" size={12} /><span>{item.name}</span><small>{favoriteCounts.collections.get(item.id) || 0}</small></button>
        </div>
      {/each}
      {/if}
    </div>
    <div aria-label="Search sources" class="library-sources" role="group">
      <label class:is-active={localSourceEnabled} class="library-source-row">
        <input checked={localSourceEnabled} onchange={(event) => onLocalSourceEnabled(event.currentTarget.checked)} type="checkbox" />
        <span class="source-check"><Icon name="check" size={11} /></span>
        <span class="source-icon"><Icon name="drive" size={14} /></span>
        <span class="library-copy"><strong>Local</strong><small>{sounds.length.toLocaleString()} indexed sounds</small></span>
      </label>
      {#if localSourceEnabled}
        <div class="local-library-branch" class:is-compact-tree={branchWidth < 260} bind:clientWidth={branchWidth} style:--tree-indent={`${treeIndent}px`}>
          {#if folders.length}
            <label class="compact-search">
              <Icon name="search" size={13} />
              <input aria-label="Search library folders" autocomplete="off" name="library-folder-search" oninput={(event) => onQueryChange(event.currentTarget.value)} placeholder="Filter local folders…" spellcheck="false" value={query} />
              {#if query}<IconButton icon="close" label="Clear library filter" onclick={() => onQueryChange("")} />{/if}
            </label>
          {/if}
          <button class:is-selected={selectedFolder === "all" && favoriteSelected === null} class="library-item library-item--all" onclick={() => onSelectFolder("all")} type="button">
            <span class="library-icon"><Icon name="library" size={14} /></span>
            <span class="library-copy"><strong>All local sounds</strong><small>Every indexed folder</small></span>
            <span class="count-badge">{sounds.length}</span>
          </button>
          {#if pinnedFolders.length}
            <div class="pinned-folders">
              <span class="pinned-folders__label"><Icon name="pin" size={11} /> Pinned</span>
              {#each pinnedFolders as node (node.id)}
                <div class={`pinned-folder-row ${node.labelColor ? `has-color-label label-${node.labelColor}` : ""}`}>
                  <button class:is-selected={selectedFolder === node.id && favoriteSelected === null} class="tooltip" data-tooltip={`Reveal ${node.name} in library tree · ${node.totalFileCount} sounds including subfolders · ${node.directFileCount} direct`} onclick={() => revealPinnedFolder(node.id)} oncontextmenu={(event) => openPinnedContext(event, node)} type="button">
                    <Icon name="folder" size={13} />
                    <span>{node.name}</span>
                    <small>{node.totalFileCount}</small>
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          {#if normalizedQuery && visibleFolders.length === 0}
            <div class="library-tree-empty">
              <span>No folders match "{query}"</span>
              <button onclick={() => onQueryChange("")} type="button">Clear filter</button>
            </div>
          {/if}
          {#each visibleFolders as folder (folder.id)}
            <LibraryTreeRow
              node={folder.tree}
              depth={0}
              selectedId={favoriteSelected === null ? selectedFolder : ""}
              {expandedIds}
              filterQuery={normalizedQuery}
              meta={`Indexed ${relativeTime(folder.indexedAt, now)}`}
              onSelect={onSelectFolder}
              onToggle={toggleTreeNode}
              onLabelColor={onFolderLabelColor}
              onTogglePinned={onToggleFolderPinned}
              onEdit={() => onEditFolder(folder.id)}
            />
          {/each}
        </div>
      {/if}
      <label class:is-active={cloudLibraryEnabled} class="library-source-row">
        <input checked={cloudLibraryEnabled} onchange={(event) => onCloudLibraryEnabled(event.currentTarget.checked)} type="checkbox" />
        <span class="source-check"><Icon name="check" size={11} /></span>
        <span class="source-icon source-icon--cloud"><Icon name="cloud" size={14} /></span>
        <span class="library-copy"><strong>Cloud SFX</strong><small>Search the online library</small></span>
      </label>
      {#if freesoundLibraryEnabled}
        <label class:is-active={freesoundSourceEnabled} class="library-source-row">
          <input checked={freesoundSourceEnabled} onchange={(event) => onFreesoundSourceEnabled(event.currentTarget.checked)} type="checkbox" />
          <span class="source-check"><Icon name="check" size={11} /></span>
          <span class="source-icon source-icon--cloud"><Icon name="cloud" size={14} /></span>
          <span class="library-copy"><strong>Freesound</strong><small>{freesoundConnected ? `${freesoundCount.toLocaleString()} cloud results` : "API key required"}</small></span>
        </label>
      {/if}
    </div>
  </div>

  {#if update.status === "available" && !updateDismissed}
    <div class="update-card" role="status">
      <span class="update-card__glyph"><Icon name="download" size={14} /></span>
      <span class="update-card__copy"><strong>Update available</strong><small>SoundDesigner {update.latestVersion}</small></span>
      <IconButton icon="download" label={`Download SoundDesigner ${update.latestVersion}`} onclick={onOpenUpdate} class="update-card__action" />
      <IconButton icon="close" label={`Dismiss SoundDesigner ${update.latestVersion} update`} onclick={onDismissUpdate} class="update-card__dismiss" />
    </div>
  {/if}

  {#if indexing}
    <div class="index-card">
      <div class="index-card__top"><span class="status-dot is-pulsing"></span><strong>Indexing library</strong><span>{indexProgress.files} files</span></div>
      <div class="meter-track is-indeterminate"><i></i></div>
      <small>{indexProgress.folders} folders · {progressLocation || "Starting…"}</small>
    </div>
  {/if}
</aside>

{#if pinnedContextNode}
  <ItemContextMenu
    open
    x={pinnedContextX}
    y={pinnedContextY}
    color={pinnedContextNode.labelColor}
    pinned={pinnedContextNode.pinned}
    canPin
    canEdit={folders.some((folder) => folder.tree.id === pinnedContextNode?.id)}
    itemName={pinnedContextNode.name}
    onColor={(color) => onFolderLabelColor(pinnedContextNode!, color)}
    onTogglePinned={() => onToggleFolderPinned(pinnedContextNode!)}
    onEdit={() => {
      const rootFolder = folders.find((folder) => folder.tree.id === pinnedContextNode?.id);
      if (rootFolder) onEditFolder(rootFolder.id);
    }}
    onClose={() => pinnedContextNode = null}
  />
{/if}
