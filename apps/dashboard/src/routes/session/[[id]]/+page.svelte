<script lang="ts">
  /**
   * The conversation on screen, and every conversation standing behind it.
   *
   * A tab click used to remount the whole workspace: the transcript was thrown
   * away and built again, virtua re-measured it up from an estimate, and the
   * reader watched a blank column resolve back into their own scroll position.
   * So the route keeps one pane per open tab and only ever hides the ones that
   * are not on screen. Switching is a `visibility` flip — nothing unmounts,
   * nothing is measured twice, and the offset and the half-typed message stay
   * put because their DOM never left.
   */
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import { workingSet } from '$lib/cockpit/working-set.svelte';
  import SessionPane from './SessionPane.svelte';

  /** One conversation with a pane of its own, and the route that opened it. */
  interface Pane {
    id: string;
    browsing: string | null;
    cwd: string;
  }

  const viewId = $derived(page.params.id ?? '');
  /** A `machine` in the query means this id is a stored session, not a live one. */
  const browsing = $derived(page.url.searchParams.get('machine'));
  const browsingCwd = $derived(page.url.searchParams.get('cwd') ?? '');

  /**
   * Insertion order, and it never re-ranks. A keyed block that reordered would
   * move a pane's DOM, and a scroller taken out of the document and put back
   * loses the offset this whole arrangement exists to keep.
   */
  let panes = $state<Pane[]>([]);

  // Before the DOM is patched rather than after: a pane that arrives a frame
  // late is a frame of empty route, which is the flash being fixed here.
  $effect.pre(() => {
    const id = viewId;
    if (!id) return;
    const machineId = browsing;
    const cwd = browsingCwd;
    untrack(() => {
      // Being on screen is what puts a conversation in the working set — and
      // the set's own limit is what bounds how many panes are kept alive.
      workingSet.visit(id);
      if (!panes.some((pane) => pane.id === id)) panes.push({ id, browsing: machineId, cwd });
    });
  });

  // A tab the reader closed, or one the working set evicted to make room for a
  // newer one, has no pane left to keep.
  $effect(() => {
    const open = new Set(workingSet.order);
    const id = viewId;
    untrack(() => {
      const keep = panes.filter((pane) => pane.id === id || open.has(pane.id));
      if (keep.length !== panes.length) panes = keep;
    });
  });
</script>

<!-- Stacked, every pane on the same box. `visibility` hides one without taking
     it out of the layout, which is the whole point: a hidden pane keeps its
     geometry, so its virtualiser keeps the heights it measured and revealing it
     needs no second pass. `display:none` and `content-visibility` both throw
     that away. -->
<div class="relative min-h-0 min-w-0 flex-1">
  {#each panes as pane (pane.id)}
    {@const active = pane.id === viewId}
    <div class="absolute inset-0 flex" class:invisible={!active} inert={!active}>
      <SessionPane viewId={pane.id} browsing={pane.browsing} browsingCwd={pane.cwd} {active} />
    </div>
  {/each}
</div>
