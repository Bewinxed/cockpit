<script lang="ts">
  /**
   * The grid: a tree of splits, drawn recursively.
   *
   * A branch is a paneforge `PaneGroup` running along one axis; a leaf is a
   * group of tabs. Nesting is the whole mechanism — a horizontal group whose
   * child is a vertical group IS an L-shaped layout, so there is no separate
   * concept of a "layout" to keep in step with the tree. What the reader
   * arranges and what gets stored are the same shape.
   *
   * Sizes are written back through `onLayoutChange` rather than left to
   * paneforge's own `autoSaveId`. Two stores for one fact drift: paneforge
   * would keep sizes under a key of its own that survives a tree mutation
   * which reshapes the group, and then apply the old numbers to new children.
   */
  import * as Resizable from '$lib/components/ui/resizable';
  import PaneLeaf from './PaneLeaf.svelte';
  import Self from './PaneGrid.svelte';
  import { workspace, type PaneNode } from './workspace.svelte';

  let { node }: { node: PaneNode } = $props();
</script>

{#if node.t === 'l'}
  <PaneLeaf leaf={node} />
{:else}
  <Resizable.PaneGroup
    direction={node.dir === 'h' ? 'horizontal' : 'vertical'}
    onLayoutChange={(sizes) => workspace.resize(node.id, sizes)}
    class="grid-group"
  >
    {#each node.kids as kid, i (kid.id)}
      {#if i > 0}
        <Resizable.Handle />
      {/if}
      <Resizable.Pane
        class="grid-pane"
        defaultSize={node.sizes[i] ?? 100 / node.kids.length}
        minSize={12}
      >
        <Self node={kid} />
      </Resizable.Pane>
    {/each}
  </Resizable.PaneGroup>
{/if}

<style>
  /* paneforge sizes a pane with flex-basis and leaves its INSIDE to the
     consumer, so without this the group inside collapses to the height of
     its own chrome — a strip and a header with nothing under them. */
  :global(.grid-pane) {
    display: flex;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* The divider is a hairline that thickens only under a pointer that is
     actually going to grab it — structure at rest, an affordance on approach. */
  :global(.grid-group [data-pane-resizer]) {
    background: var(--border-hairline);
    transition: background-color var(--c-100) var(--e-in);
  }
  @media (hover: hover) and (pointer: fine) {
    :global(.grid-group [data-pane-resizer]:hover) {
      background: var(--border-control);
    }
  }
  :global(.grid-group [data-pane-resizer][data-active='pointer']),
  :global(.grid-group [data-pane-resizer][data-active='keyboard']) {
    background: var(--ink-muted);
  }
  @media (prefers-reduced-motion: reduce) {
    :global(.grid-group [data-pane-resizer]) {
      transition: none;
    }
  }
</style>
