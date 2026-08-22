<script lang="ts">
  /**
   * The open conversations, as a browser-tab strip.
   *
   * Fleet leads it, but it is a HOME rather than a peer: it never closes, it
   * carries no session mark, and a rule of its own separates it from the
   * conversations — so "where everything is" and "the things I am holding open"
   * read as two kinds of destination rather than one undifferentiated row.
   *
   * Ported from mocks/v5-workspace.html (.tabstrip): the active tab is raised
   * off the strip and carries strong ink, so the selection survives greyscale.
   */
  import { onMount, untrack, type Component } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { IconBoxDuo, IconClose } from '$lib/icons';
  import { cockpit } from './client.svelte';
  import { resolveSessionTitle } from './links';
  import { markHue, sessionSprite } from './mark';
  import { workingSet } from './working-set.svelte';

  interface Tab {
    id: string;
    href: string;
    label: string;
    hue: ReturnType<typeof markHue>;
    /** The session's own face — keyed to the id, so two tabs on one repo differ. */
    sprite: Component;
  }

  /** One tab as the root layout's server load resolved it, from the cookie. */
  interface ServerTab {
    id: string;
    href: string;
    label: string;
    seed: string;
  }

  const path = $derived(page.url.pathname);

  /**
   * The strip is server-rendered from the working-set COOKIE, so a reload paints
   * the reader's real tabs instead of an empty strip that fills in on mount.
   * `workingSet` reads localStorage, which the server cannot — so the first
   * client render has to draw the same list the server did, or hydration would
   * mismatch. This gate is that: cookie list until mounted, live set after.
   * The cookie is written on every mutation, so the two agree and the handover
   * moves nothing.
   */
  let mounted = $state(false);
  onMount(() => {
    mounted = true;
  });

  const servedTabs = $derived((page.data as { tabs?: ServerTab[] }).tabs ?? []);

  /**
   * What the server called each tab. Held as the client's own fallback, because
   * for a beat after mount the client knows LESS than the server did: the fleet
   * rows arrive over the socket, so a tab whose name came from its folder would
   * drop to a bare id until they land. Falling back to the server's own answer
   * is what makes the handover invisible for every tab, not just the open one.
   */
  const servedLabels = $derived(new Map(servedTabs.map((tab) => [tab.id, tab.label])));

  const served = $derived(servedTabs.map(
    (tab): Tab => ({
      id: tab.id,
      href: tab.href,
      label: tab.label,
      hue: markHue(tab.seed),
      sprite: sessionSprite(tab.id),
    })
  ));

  /**
   * One tab, named. `named` says whether the label came from what the session
   * IS — a title somebody or the harness gave it, or the first thing it was
   * asked — rather than from the folder-and-id fallback. Only a named label is
   * worth remembering: the fallback is what the server can work out for itself.
   */
  function resolve(id: string): Tab & { named: boolean } {
    const row = cockpit.instances.find((instance) => instance.id === id);
    const view = cockpit.session(id);
    // A stored session addresses itself with its machine/cwd/harness; drop
    // that and /session/{id} opens a different session with the same id. Live
    // sessions have no context and are addressed by id alone.
    const ctx = workingSet.contextOf(id);
    const href = ctx
      ? `/session/${id}?${new URLSearchParams({ machine: ctx.machine, cwd: ctx.cwd, harness: ctx.harness })}`
      : `/session/${id}`;
    const title = row?.title;
    const firstMessage = view?.messages.find((m) => m.type === 'user' && m.content.trim())?.content;
    const named = !!title?.trim() || !!firstMessage?.trim();
    // The same helper the header names the session with, so the tab and the
    // bar under it can never be reading two different conversations.
    const resolved = resolveSessionTitle({
      title,
      firstMessage,
      cwd: view?.cwd || row?.cwd || ctx?.cwd,
      id,
    });
    return {
      id,
      href,
      // Until the fleet and the transcript have both answered, a conversation
      // this browser has named before keeps that name. Falling back to the
      // folder for the moment between mount and the first frame is the flash
      // the remembered title exists to remove — in the other direction.
      label: named ? resolved : (workingSet.titleOf(id) ?? servedLabels.get(id) ?? resolved),
      hue: markHue(view?.cwd || row?.cwd || ctx?.cwd || id),
      sprite: sessionSprite(id),
      named,
    };
  }

  const held = $derived.by(() => workingSet.order.map(resolve));

  const tabs = $derived(mounted ? held : served);

  // Remember every name the strip works out, so the SERVER can draw the strip
  // with it next time. A title is mostly derived from the transcript, which a
  // render has no access to — so without this the tab was server-rendered as
  // its folder and renamed itself the moment the page hydrated. Writing it back
  // is what makes the server's label the final one.
  $effect(() => {
    const named = held.filter((tab) => tab.named).map((tab) => [tab.id, tab.label] as const);
    // Untracked: the write reads the record it is writing to (the cookie is the
    // whole set serialised), and a tracked effect would take its own write as a
    // dependency and re-run itself for as long as it kept changing anything.
    untrack(() => {
      for (const [id, label] of named) workingSet.setTitle(id, label);
    });
  });

  /** Closing the tab you are reading leaves you on the board, not on a dead id. */
  function close(id: string) {
    workingSet.forget(id);
    if (path === `/session/${id}`) goto('/session');
  }
</script>

<div class="tabstrip" role="tablist" aria-label="Open sessions">
  <a
    class="tab home"
    class:on={path === '/session'}
    href="/session"
    role="tab"
    aria-selected={path === '/session'}
  >
    <span class="hic" aria-hidden="true"><IconBoxDuo /></span>
    <span class="nm">Fleet</span>
  </a>
  {#if tabs.length > 0}
    <span class="rule" aria-hidden="true"></span>
  {/if}
  {#each tabs as tab (tab.id)}
    {@const active = path === `/session/${tab.id}`}
    {@const Sprite = tab.sprite}
    <div class="tab" class:on={active}>
      <a class="tl" href={tab.href} role="tab" aria-selected={active} title={tab.label}>
        <span class="tm m{tab.hue}" aria-hidden="true"><Sprite /></span>
        <span class="nm">{tab.label}</span>
      </a>
      <button type="button" class="tclose" aria-label="Close {tab.label}" onclick={() => close(tab.id)}>
        <IconClose />
      </button>
    </div>
  {/each}
</div>

<style>
  .tabstrip {
    display: flex;
    align-items: stretch;
    gap: 2px;
    flex-shrink: 0;
    padding: 6px var(--space-6) 6px var(--space-7);
    border-bottom: 1px solid var(--border-hairline);
    background: var(--surface-raised);
    overflow-x: auto;
    scrollbar-width: thin;
  }

  .tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
    padding: 0 10px;
    height: 38px;
    max-width: 200px;
    border: 1px solid transparent;
    /* Concentric: the tab's own radius, less its 6px inset, is the radius of
       the mark and the close target seated inside it. */
    border-radius: var(--radius-control);
    background: var(--surface-field);
    color: var(--ink-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    text-decoration: none;
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in);
  }
  .tab.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: var(--weight-strong);
    border-color: var(--border-hairline);
    box-shadow: var(--shadow-tile);
  }
  @media (hover: hover) and (pointer: fine) {
    .tab:hover:not(.on) {
      background: var(--surface-hover);
    }
  }

  /* Fleet is a home, not a conversation: no mark, no close, and a rule between
     it and the tabs so the two kinds of destination are told apart at a glance
     rather than by reading the labels. */
  .home {
    gap: var(--space-2);
    padding-left: var(--space-3);
    padding-right: var(--space-3);
  }
  .hic {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    color: var(--ink-muted);
  }
  .home.on .hic {
    color: var(--ink-strong);
  }
  .hic :global(svg) {
    width: 15px;
    height: 15px;
    display: block;
  }
  .rule {
    flex: 0 0 auto;
    width: 1px;
    margin: 8px 6px;
    background: var(--border-hairline);
  }

  .tl {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: inherit;
    text-decoration: none;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  /* Item mark — inlined token primitive (17px recipe at 14px for the tab strip):
     identity hue + the session's own duotone sprite, top-light/bottom-shade
     overlay. No clean shadcn equivalent, so a minimal token-styled mark stands
     in. Kept identical in recipe across Sidebar / LiveSessionRow /
     StoredSessionRow / SessionTabs. */
  .tm {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .tm :global(svg) {
    width: 10px;
    height: 10px;
    display: block;
    /* Duotone fills from currentColor and carries its own second tone as
       opacity, so one colour is the whole glyph. */
    color: var(--mark-glyph);
  }
  .tm.m2 { background-color: var(--mark-2); }
  .tm.m3 { background-color: var(--mark-3); }
  .tm.m4 { background-color: var(--mark-4); }
  .tm.m5 { background-color: var(--mark-5); }
  .tm.m6 { background-color: var(--mark-6); }
  .tm.m7 { background-color: var(--mark-7); }
  .tm.m8 { background-color: var(--mark-8); }

  .tclose {
    width: 18px;
    height: 18px;
    border: 0;
    padding: 0;
    background: none;
    color: var(--ink-muted);
    border-radius: var(--radius-mark);
    display: grid;
    place-items: center;
    cursor: pointer;
    flex: 0 0 auto;
    transition:
      background-color var(--c-100) var(--e-in),
      color var(--c-100) var(--e-in),
      transform var(--c-100) var(--e-in);
  }
  .tclose :global(svg) {
    width: 11px;
    height: 11px;
    display: block;
  }
  @media (hover: hover) and (pointer: fine) {
    .tclose:hover {
      background: var(--surface-active);
      color: var(--ink-strong);
    }
  }
  .tclose:active {
    transform: scale(0.9);
  }

  .tab:focus-visible,
  .tl:focus-visible,
  .tclose:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  @media (prefers-reduced-motion: reduce) {
    .tab,
    .tclose {
      transition: none;
    }
    .tclose:active {
      transform: none;
    }
  }
</style>
