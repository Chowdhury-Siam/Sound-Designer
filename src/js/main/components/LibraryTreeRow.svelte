<script lang="ts">
  import type { LibraryTreeNode } from "../types";
  import { treeMatchesQuery } from "../ui-utils";
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

  let visibleChildren = $derived(node.children.filter((child) => treeMatchesQuery(child, filterQuery)));
  let hasChildren = $derived(visibleChildren.length > 0);
  let expanded = $derived(filterQuery.length > 0 || expandedIds.has(node.id));
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

<div class="library-tree-branch">
  <div
    class={`library-tree-row ${node.labelColor ? `has-color-label label-${node.labelColor}` : ""}`}
    class:is-pinned={node.pinned}
    class:is-selected={selectedId === node.id}
    oncontextmenu={openContextMenu}
    role="group"
    aria-label={node.name}
    style:padding-inline-start={`${4 + depth * 13}px`}
  >
    <button
      aria-label={`${expanded ? "Collapse" : "Expand"} ${node.name}`}
      class:is-expanded={expanded}
      class="tree-expander"
      disabled={!hasChildren}
      onclick={() => onToggle(node.id)}
      type="button"
    ><Icon name="chevron" size={12} /></button>
    <button class="library-tree-select" onclick={() => onSelect(node.id)} type="button">
      <span class="library-icon"><Icon name="folder" size={14} /></span>
      <span class="library-copy">
        <strong>{node.name}</strong>
        <small>{meta || (node.children.length ? `${node.children.length} folders` : `${node.directFileCount} sounds`)}</small>
      </span>
      <span class="count-badge">{node.totalFileCount}</span>
    </button>
  </div>
  <ItemContextMenu
    open={contextOpen}
    x={contextX}
    y={contextY}
    color={node.labelColor}
    pinned={node.pinned}
    canPin
    canEdit={Boolean(onEdit)}
    itemName={node.name}
    onColor={(color) => onLabelColor(node, color)}
    onTogglePinned={() => onTogglePinned(node)}
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
