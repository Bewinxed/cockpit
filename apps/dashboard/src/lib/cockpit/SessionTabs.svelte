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
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import type { Component } from 'svelte';
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

  const path = $derived(page.url.pathname);

  const tabs = $derived.by((): Tab[] =>
    workingSet.order.map((id) => {
      const row = cockpit.instances.find((instance) => instance.id === id);
      const view = cockpit.session(id);
      // A stored session addresses itself with its machine/cwd/harness; drop
      // that and /session/{id} opens a different session with the same id. Live
      // sessions have no context and are addressed by id alone.
      const ctx = workingSet.contextOf(id);
      const href = ctx
        ? `/session/${id}?${new URLSearchParams({ machine: ctx.machine, cwd: ctx.cwd, harness: ctx.harness })}`
        : `/session/${id}`;
      return {
        id,
        href,
        // The same helper the header names the session with, so the tab and the
        // bar under it can never be reading two different conversations.
        label: resolveSessionTitle({
          title: row?.title,
          firstMessage: view?.messages.find((m) => m.type === 'user' && m.content.trim())?.content,
          cwd: view?.cwd || row?.cwd || ctx?.cwd,
          id,
        }),
        hue: markHue(view?.cwd || row?.cwd || ctx?.cwd || id),
        sprite: sessionSprite(id),
      };
    })
  );

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
