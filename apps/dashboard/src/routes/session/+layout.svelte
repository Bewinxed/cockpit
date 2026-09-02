<script lang="ts">
  /**
   * The workspace surface: the fleet board, and the groups of conversations
   * arranged over it.
   *
   * What this file owns is small, deliberately. It reconciles the URL with
   * the workspace, holds the server's answer for whichever conversation the
   * page was entered with, and decides whether the reader gets a grid or a
   * single group. Everything about a group — its tabs, its identity bar, its
   * swipe — belongs to `PaneLeaf`, once per group rather than once per app.
   * That is what makes a split two workstations instead of one view showing
   * two things. The conversations themselves belong to `PaneHost`, mounted
   * once each and docked into whichever group holds them.
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
  import { browser } from '$app/environment';
  import FleetBoard from '$lib/whiffle/FleetBoard.svelte';
  import PaneGrid from '$lib/whiffle/workspace/PaneGrid.svelte';
  import PaneDeck from '$lib/whiffle/workspace/PaneDeck.svelte';
  import PaneHost from '$lib/whiffle/workspace/PaneHost.svelte';
  import { syncSubscriptions, type HistorySource } from '$lib/whiffle/client.svelte';
  import { workspace, type WorkspaceV1 } from '$lib/whiffle/workspace/workspace.svelte';
  import { IsMobile } from '$lib/hooks/is-mobile.svelte';

  let { children }: { children: Snippet } = $props();

  // On the server, before the groups render: the module-level store is shared
  // across requests, so each render adopts its own cookie's tree first.
  if (!browser) workspace.serve((page.data as { workspace?: WorkspaceV1 | null }).workspace ?? null);

  /** 900px is this app's desktop line, not the 768 the hook defaults to. */
  const mobile = new IsMobile(900);
  /**
   * The media query cannot run on the server, so its answer there is the
   * `whiffle-narrow` cookie this browser wrote last time (or, on a first
   * visit, what its headers suggest). On the client the query is right
   * synchronously, so hydration on a phone finds the deck already painted.
   */
  const narrow = $derived(browser ? mobile.current : (page.data.narrow as boolean));

  $effect(() => {
    document.cookie = `whiffle-narrow=${mobile.current ? 1 : 0};path=/;max-age=31536000;samesite=lax`;
  });

  const onBoard = $derived(workspace.activeSessionId === null);

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

  // Synchronously, during the first client render. The store restores what
  // was open from localStorage at module load, so without this the first
  // paint showed whatever conversation was last active and only corrected to
  // the URL's answer on mount — the view visibly changing under the reader a
  // frame after it appeared. The URL is the address; it wins before anything
  // is drawn, not after.
  if (browser) reconcileFromUrl();

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
    <!-- A phone shows one group at a time; the grid is a desktop arrangement.
         The tree still holds whatever splits were made at a desk, and the
         deck makes them reachable: the groups are a vertical stack that two
         fingers page through, so widening the window restores the grid and
         narrowing it loses nothing. -->
    {#if narrow}
      <PaneDeck />
    {:else}
      <PaneGrid node={workspace.root} />
    {/if}
    <!-- After the groups on purpose: their slots register first, so a pane
         is born straight into the group that asked for it. -->
    <PaneHost entryId={entry.id} entryTail={entry.tail} entryHistory={entry.history} />
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
  }

  /* `visibility`, never `display`: a hidden surface still lays out, so the
     virtualisers inside it keep their measurements and revealing one costs
     nothing.
     Only the HIDDEN state is declared, here and everywhere below this.
     `visibility` inherits, but a descendant re-declaring `visible` un-hides
     itself through a hidden ancestor — so a single `visibility: visible`
     deeper in the tree is enough to paint a whole surface that is supposed
     to be put away. */
  .hidden-surface {
    visibility: hidden;
    pointer-events: none;
  }
</style>
