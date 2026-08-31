<script lang="ts">
  /**
   * Session pane stacking and tab-switch animation.
   *
   * One pane is kept per open tab. Switching flips `visibility` — nothing
   * unmounts, nothing is measured twice, scroll positions survive.
   *
   * Animation: the SESSION HEADER appears instantly (same layout position,
   * same structure) — text morphs via torph in SessionHeader. Only the
   * BODY (transcript + composer) slides directionally based on the tab
   * strip position. Fleet board fully hides/shows.
   */
  import type { Snippet } from 'svelte';
  import { untrack } from 'svelte';
  import { page } from '$app/state';
  import FleetBoard from '$lib/cockpit/FleetBoard.svelte';
  import SessionPane from '$lib/cockpit/SessionPane.svelte';
  import { syncSubscriptions } from '$lib/cockpit/client.svelte';
  import { workingSet } from '$lib/cockpit/working-set.svelte';

  let { children }: { children: Snippet } = $props();

  interface Pane {
    id: string;
    browsing: string | null;
    cwd: string;
    harness: string;
  }

  const viewId = $derived(page.params.id ?? '');
  const onBoard = $derived(page.url.pathname === '/session');

  /** Slide direction for the transcript body on tab switch. */
  let prevViewId = $state(viewId);
  let slideDir = $state<'' | 'left' | 'right'>('');

  $effect.pre(() => {
    const cur = viewId;
    const prev = prevViewId;
    if (cur === prev) return;
    const order = workingSet.order;
    const curIdx = order.indexOf(cur);
    const prevIdx = order.indexOf(prev);
    slideDir = curIdx > prevIdx ? 'left' : curIdx < prevIdx ? 'right' : '';
    prevViewId = cur;
  });

  $effect(() => {
    if (!slideDir) return;
    const id = setTimeout(() => { slideDir = ''; }, 250);
    return () => clearTimeout(id);
  });

  const browsing = $derived(page.url.searchParams.get('machine'));
  const browsingCwd = $derived(page.url.searchParams.get('cwd') ?? '');
  const browsingHarness = $derived(page.url.searchParams.get('harness') ?? 'claude');

  let panes = $state<Pane[]>(
    viewId ? [{ id: viewId, browsing, cwd: browsingCwd, harness: browsingHarness }] : []
  );

  $effect.pre(() => {
    const id = viewId;
    if (!id) return;
    const machineId = browsing;
    const cwd = browsingCwd;
    const harness = browsingHarness;
    untrack(() => {
      workingSet.visit(id, { machine: machineId, cwd, harness });
      const held = panes.find((pane) => pane.id === id);
      if (!held) {
        panes.push({ id, browsing: machineId, cwd, harness });
        return;
      }
      if (machineId && !held.browsing) {
        held.browsing = machineId;
        held.cwd = cwd;
        held.harness = harness;
      }
    });
  });

  $effect(() => {
    const open = new Set(workingSet.order);
    const id = viewId;
    untrack(() => {
      const keep = panes.filter((pane) => pane.id === id || open.has(pane.id));
      if (keep.length !== panes.length) panes = keep;
    });
  });

  $effect(() => {
    syncSubscriptions();
  });
</script>

<div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
  <div
    class="pane absolute inset-0 flex"
    class:pane-hidden={!onBoard}
    inert={!onBoard}
  >
    <FleetBoard active={onBoard} />
  </div>

  {#each panes as pane (pane.id)}
    {@const active = pane.id === viewId && !onBoard}
    <div
      class="pane absolute inset-0 flex"
      class:pane-hidden={!active}
      inert={!active}
    >
      <SessionPane
        viewId={pane.id}
        browsing={pane.browsing}
        browsingCwd={pane.cwd}
        browsingHarness={pane.harness}
        {active}
        {slideDir}
      />
    </div>
  {/each}

  {@render children()}
</div>

<style>
  /* Pane visibility: only the active pane is shown. The header appears
     instantly (same position, same layout) — from the user's perspective
     it persists while torph morphs the text. The body slides in/out
     via SessionPane's internal animation keyed to slideDir. */
  .pane {
    opacity: 1;
    visibility: visible;
  }

  .pane-hidden {
    visibility: hidden;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .pane,
    .pane-hidden {
      transition: none;
    }
  }
</style>
