<script lang="ts">
  /**
   * Everywhere the reader works, and every conversation standing behind it.
   *
   * A tab click used to remount the whole workspace: the transcript was thrown
   * away and built again, virtua re-measured it up from an estimate, and the
   * reader watched a blank column resolve back into their own scroll position.
   * So one pane is kept per open tab and only the ones that are not on screen
   * are hidden. Switching is a `visibility` flip — nothing unmounts, nothing is
   * measured twice, and the offset and the half-typed message stay put because
   * their DOM never left.
   *
   * The panes live in the layout rather than in the page, because a pane the
   * page owned was torn down the moment the reader looked at the fleet, and
   * every tab they came back to was cold again. Held here they outlive the whole
   * strip, board included — Fleet is one more thing to switch between, not
   * somewhere the tabs stop existing. The route under this is `[[id]]`, one
   * route for both URLs, so moving between the board and a conversation is a
   * parameter change the router swaps no components for.
   */
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import FleetBoard from '$lib/cockpit/FleetBoard.svelte';
  import SessionPane from '$lib/cockpit/SessionPane.svelte';
  import { workingSet } from '$lib/cockpit/working-set.svelte';

  let { children }: { children: Snippet } = $props();

  /** One conversation with a pane of its own, and the route that opened it. */
  interface Pane {
    id: string;
    browsing: string | null;
    cwd: string;
    harness: string;
  }

  /** Empty on the board, which is the one tab that is not a conversation. */
  const viewId = $derived(page.params.id ?? '');
  const onBoard = $derived(page.url.pathname === '/session');
  /** A `machine` in the query means this id is a stored session, not a live one. */
  const browsing = $derived(page.url.searchParams.get('machine'));
  const browsingCwd = $derived(page.url.searchParams.get('cwd') ?? '');
  const browsingHarness = $derived(page.url.searchParams.get('harness') ?? 'claude');

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
    const harness = browsingHarness;
    untrack(() => {
      // Being on screen is what puts a conversation in the working set — and
      // the set's own limit is what bounds how many panes are kept alive.
      workingSet.visit(id);
      if (!panes.some((pane) => pane.id === id)) panes.push({ id, browsing: machineId, cwd, harness });
    });
  });

  // A tab the reader closed, or one the working set evicted to make room for a
  // newer one, has no pane left to keep. The board keeps all of them: leaving
  // the conversations is not closing them.
  $effect(() => {
    const open = new Set(workingSet.order);
    const id = viewId;
    untrack(() => {
      const keep = panes.filter((pane) => pane.id === id || open.has(pane.id));
      if (keep.length !== panes.length) panes = keep;
    });
  });
</script>

<!-- Stacked, everything on the same box, exactly one of them shown. `visibility`
     hides a pane without taking it out of the layout, which is the whole point:
     it keeps its geometry, so its virtualiser keeps the heights it measured and
     revealing it needs no second pass. `display:none` and `content-visibility`
     both throw that away. Hidden things are `inert` too, so the one on screen is
     the only one that can be clicked, focused or typed into. -->
<div class="relative min-h-0 min-w-0 flex-1">
  <!-- Fleet is the strip's first tab, so the board is one more thing to switch
       between rather than somewhere the tabs stop: it is kept and hidden exactly
       as the conversations are, down to where it was scrolled and what it was
       peeking at. -->
  <div class="absolute inset-0 flex" class:invisible={!onBoard} inert={!onBoard}>
    <FleetBoard active={onBoard} />
  </div>
  {#each panes as pane (pane.id)}
    {@const active = pane.id === viewId}
    <div class="absolute inset-0 flex" class:invisible={!active} inert={!active}>
      <SessionPane viewId={pane.id} browsing={pane.browsing} browsingCwd={pane.cwd} browsingHarness={pane.harness} {active} />
    </div>
  {/each}
  <!-- `[[id]]` is a declaration: what the URL names is drawn above. Rendered so
       anything added under `/session` later still lands in the layout that
       hosts it. -->
  {@render children()}
</div>
