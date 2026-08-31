<script lang="ts">
  /**
   * The workspace surface: the fleet board, and the groups of conversations
   * arranged over it.
   *
   * What this file owns is small, deliberately. It reconciles the URL with
   * the workspace, holds the server's answer for whichever conversation the
   * page was entered with, and decides whether the reader gets a grid or a
   * single group. Everything about a group — its tabs, its identity bar, its
   * panes, its swipe — belongs to `PaneLeaf`, once per group rather than once
   * per app. That is what makes a split two workstations instead of one view
   * showing two things.
   *
   * The active conversation is `workspace.activeSessionId`, a plain piece of
   * state, not `page.params.id`. Showing one assigns it and re-renders in the
   * same frame; the URL is written afterwards with `pushState`, which runs no
   * load. Because no load runs, `page.data` cannot change on a switch, so the
   * server tail cannot land late and rebuild a transcript already on screen —
   * which is what the View-Transition suppression flag and the one-frame
   * animation guards used to be hiding.
   */
  import type { Snippet } from 'svelte';
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { page } from '$app/state';
  import FleetBoard from '$lib/cockpit/FleetBoard.svelte';
  import PaneGrid from '$lib/cockpit/workspace/PaneGrid.svelte';
  import PaneLeaf from '$lib/cockpit/workspace/PaneLeaf.svelte';
  import { syncSubscriptions, type HistorySource } from '$lib/cockpit/client.svelte';
  import { workspace } from '$lib/cockpit/workspace/workspace.svelte';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';

  let { children }: { children: Snippet } = $props();

  /** 900px is this app's desktop line, not the 768 the hook defaults to. */
  const narrow = new IsMobile(900);

  const onBoard = $derived(workspace.activeSessionId === null);

  /**
   * A phone gets ONE group and the swipe; the grid is a desktop arrangement.
   * The tree still holds whatever splits were made at a desk — it is simply
   * not drawn — so widening the window restores them rather than discarding
   * them.
   */
  const soleLeaf = $derived(
    workspace.leaves.find((leaf) => leaf.id === workspace.focusedLeafId) ?? workspace.leaves[0]
  );

  /* ── The server's answer, claimed once ───────────────────────────────
     `page.data` only changes on a REAL navigation — a cold load, a deep
     link, an arrival from another route. It is captured by value at the two
     moments it can differ, and handed to the one pane it belongs to. Read
     reactively, it was the mechanism by which a late-landing tail rebuilt a
     transcript mid-animation. */

  interface EntryData {
    id: string;
    tail: unknown;
    history: Promise<HistorySource | null> | null;
  }

  const captureEntry = (): EntryData => ({
    id: page.params.id ?? '',
    tail: (page.data as { tail?: unknown }).tail ?? null,
    history: (page.data as { history?: Promise<HistorySource | null> | null }).history ?? null,
  });

  let entry = $state<EntryData>(captureEntry());
  afterNavigate(() => {
    entry = captureEntry();
    reconcileFromUrl();
  });

  /* ── URL → workspace ─────────────────────────────────────────────────
     Deliberately NOT a `$effect` on `page.url`. A shallow `pushState` does
     not re-run this layout's effects — measured, not assumed: an
     instrumented effect fired twice at mount and never again across three
     tab clicks and two back presses, leaving the store a whole history entry
     behind the address bar. There are exactly two ways the URL can move
     without this store having moved first, and both are events: the browser
     walking history, and a real navigation from another route. */

  function reconcileFromUrl(): void {
    const url = new URL(location.href);
    const parts = url.pathname.split('/').filter(Boolean);
    // Another route entirely — leave the workspace holding what it holds, so
    // a trip to Usage and back does not cost the reader their place.
    if (parts[0] !== 'session') return;
    const urlId = parts[1] ?? null;
    if (urlId === workspace.activeSessionId) return;
    // Only carry context when the URL actually names a machine. A stored
    // conversation's machine and folder are how it is addressed at all, and
    // `workingSet.visit` SPREADS what it is given over what it holds — so a
    // blank context from a URL with no query string erases the real one, and
    // a pane that was reading a transcript reports itself unreachable.
    const machine = url.searchParams.get('machine');
    workspace.reveal(
      urlId,
      urlId && machine
        ? {
            machine,
            cwd: url.searchParams.get('cwd') ?? '',
            harness: url.searchParams.get('harness') ?? 'claude',
          }
        : undefined
    );
  }

  onMount(() => {
    reconcileFromUrl();
    const onPop = () => reconcileFromUrl();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  $effect(() => {
    syncSubscriptions();
  });
</script>

<div class="surface">
  <!-- The board is a HOME rather than a peer: it is what is there when no
       conversation is, and it holds its scroll position underneath the
       groups rather than being rebuilt on every visit. -->
  <div class="board" class:hidden-surface={!onBoard} inert={!onBoard}>
    <FleetBoard active={onBoard} />
  </div>

  <div class="groups" class:hidden-surface={onBoard} inert={onBoard}>
    {#if narrow.current}
      {#if soleLeaf}
        <PaneLeaf
          leaf={soleLeaf}
          entryId={entry.id}
          entryTail={entry.tail}
          entryHistory={entry.history}
          swipeable
          showTabs={false}
        />
      {/if}
    {:else}
      <PaneGrid
        node={workspace.root}
        entryId={entry.id}
        entryTail={entry.tail}
        entryHistory={entry.history}
      />
    {/if}
  </div>

  {@render children()}
</div>

<style>
  .surface {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .board,
  .groups {
    position: absolute;
    inset: 0;
    display: flex;
    min-width: 0;
    min-height: 0;
    visibility: visible;
  }

  /* `visibility`, never `display`: a hidden surface still lays out, so the
     virtualisers inside it keep their measurements and revealing one costs
     nothing. */
  .hidden-surface {
    visibility: hidden;
    pointer-events: none;
  }
</style>
