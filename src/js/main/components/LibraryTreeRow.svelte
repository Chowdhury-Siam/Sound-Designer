<script lang="ts">
  import type { LibraryTreeNode } from "../types";
  import { compactChain, treeMatchesQuery } from "../ui-utils";
  import Icon from "./Icon.svelte";
  import ItemContextMenu from "./ItemContextMenu.svelte";
  import LibraryTreeRow from "./LibraryTreeRow.svelte";

  let {
    node,
    depth,
    selectedId,
    expandedIds,
    filterQuery,
    meta,
    onSelect,
    onToggle,
    onLabelColor,
    onTogglePinned,
    onEdit,
  }: {
    node: LibraryTreeNode;
    depth: number;
    selectedId: string;
    expandedIds: Set<string>;
    filterQuery: string;
    meta?: string;
    onSelect: (nodeId: string) => void;
    onToggle: (nodeId: string) => void;
    onLabelColor: (node: LibraryTreeNode, color: LibraryTreeNode["labelColor"]) => void;
    onTogglePinned: (node: LibraryTreeNode) => void;
    onEdit?: () => void;
  } = $props();

  // Compact folders: merge single-child chains into one row, e.g. "Botanica / V4 / Botanica v4".
  let chain = $derived(compactChain(node, filterQuery));
  let tail = $derived(chain[chain.length - 1]);
  let chainLabel = $derived(chain.map((part) => part.name).join(" / "));
  let visibleChildren = $derived(tail.children.filter((child) => treeMatchesQuery(child, filterQuery)));
  let hasChildren = $derived(visibleChildren.length > 0);
  let folderCountLabel = $derived(`${visibleChildren.length} ${filterQuery ? "matching " : ""}subfolder${visibleChildren.length === 1 ? "" : "s"}`);
  let expanded = $derived(filterQuery.length > 0 || expandedIds.has(tail.id));
  let contextOpen = $state(false);
  let contextX = $state(0);
  let contextY = $state(0);

  const openContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    contextX = Math.max(8, Math.min(window.innerWidth - 220, event.clientX));
    contextY = Math.max(8, Math.min(window.innerHeight - 220, event.clientY));
    contextOpen = true;
  };
</script>

<div class="library-tree-branch" style:--depth={depth}>
  <div
    class={`library-tree-row ${tail.labelColor ? `has-color-label label-${tail.labelColor}` : ""}`}
    class:is-pinned={tail.pinned}
    class:is-selected={chain.some((part) => part.id === selectedId)}
    class:is-root={depth === 0}
    class:is-branch-open={hasChildren && expanded}
    class:has-subfolders={hasChildren}
    class:is-leaf={!hasChildren}
    oncontextmenu={openContextMenu}
    role="group"
    aria-label={chainLabel}
    data-library-node={JSON.stringify(chain.map((part) => part.id))}
  >
    <button
      aria-label={`${expanded ? "Collapse" : "Expand"} ${chainLabel}`}
      aria-expanded={hasChildren ? expanded : undefined}
      class:is-expanded={expanded}
      class="tree-expander"
      disabled={!hasChildren}
      onclick={() => onToggle(tail.id)}
      type="button"
    ><Icon name="chevron" size={12} /></button>
    <button class="library-tree-select tooltip" data-tooltip={`${tail.path} · ${tail.directFileCount} direct sounds · ${tail.totalFileCount} including subfolders${meta ? ` · ${meta}` : ""}`} onclick={() => onSelect(tail.id)} type="button">
      <span class="library-icon"><Icon name={hasChildren ? "folderStack" : "folder"} size={14} /></span>
      <span class="library-copy">
        <strong>{#each chain as part, index (part.id)}{#if index}<span class="tree-chain-sep">/</span>{/if}{part.name}{/each}</strong>
      </span>
      <span class="count-badge" aria-label={`${tail.totalFileCount} sounds including subfolders`}>{tail.totalFileCount}</span>
    </button>
    {#if hasChildren}
      {#if filterQuery}
        <span class="tree-folder-toggle tooltip" data-tooltip={folderCountLabel} aria-label={folderCountLabel}>
          <Icon name="folderStack" size={12} /><span>{visibleChildren.length}</span><span class="tree-folder-label">{visibleChildren.length === 1 ? "folder" : "folders"}</span>
        </span>
      {:else}
        <button class="tree-folder-toggle tooltip" class:is-expanded={expanded} data-tooltip={`${folderCountLabel} · ${expanded ? "Collapse" : "Expand"}`} aria-label={`${expanded ? "Collapse" : "Expand"} ${folderCountLabel} in ${chainLabel}`} aria-expanded={expanded} onclick={() => onToggle(tail.id)} type="button">
          <Icon name="folderStack" size={12} /><span>{visibleChildren.length}</span><span class="tree-folder-label">{visibleChildren.length === 1 ? "folder" : "folders"}</span>
        </button>
      {/if}
    {/if}
  </div>
  <ItemContextMenu
    open={contextOpen}
    x={contextX}
    y={contextY}
    color={tail.labelColor}
    pinned={tail.pinned}
    canPin
    canEdit={Boolean(onEdit)}
    itemName={tail.name}
    onColor={(color) => onLabelColor(tail, color)}
    onTogglePinned={() => onTogglePinned(tail)}
    {onEdit}
    onClose={() => contextOpen = false}
  />
  {#if hasChildren && expanded}
    <div class="library-tree-children">
      {#each visibleChildren as child (child.id)}
        <LibraryTreeRow
          node={child}
          depth={depth + 1}
          {selectedId}
          {expandedIds}
          {filterQuery}
          {onSelect}
          {onToggle}
          {onLabelColor}
          {onTogglePinned}
        />
      {/each}
    </div>
  {/if}
</div>
