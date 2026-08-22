<script lang="ts">
  /**
   * The open conversations, as a browser-tab strip. Fleet is the first tab —
   * leaving the conversations is not closing them — and the rest are whatever
   * the working set holds, in the order they were opened.
   *
   * Ported from mocks/v5-workspace.html (.tabstrip): the active tab is raised
   * off the strip and carries strong ink, so the selection survives greyscale.
   */
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { IconClose } from '$lib/icons';
  import { cockpit } from './client.svelte';
  import { harnessGlyphPath, markHue } from './mark';
  import { workingSet } from './working-set.svelte';

  interface Tab {
    id: string;
    label: string;
    hue: ReturnType<typeof markHue>;
    glyph: string;
  }

  const path = $derived(page.url.pathname);

  const tabs = $derived.by((): Tab[] =>
    workingSet.order.map((id) => {
      const row = cockpit.instances.find((instance) => instance.id === id);
      return {
        id,
        label: row?.title?.trim() || row?.cwd.split('/').filter(Boolean).pop() || id.slice(0, 8),
        hue: markHue(row?.cwd || row?.machineId || id),
        glyph: harnessGlyphPath(row?.harness),
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
  <a class="tab" class:on={path === '/session'} href="/session" role="tab" aria-selected={path === '/session'}>
    <span class="tl">Fleet</span>
  </a>
  {#each tabs as tab (tab.id)}
    {@const active = path === `/session/${tab.id}`}
    <div class="tab" class:on={active}>
      <a class="tl" href="/session/{tab.id}" role="tab" aria-selected={active}>
        <span class="tm m{tab.hue}" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
            <path d={tab.glyph} />
          </svg>
        </span>
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
    border-radius: var(--radius-control);
    background: var(--surface-field);
    color: var(--ink-body);
    font-size: var(--text-base);
    font-weight: var(--weight-medium);
    white-space: nowrap;
    text-decoration: none;
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
     identity hue + harness glyph, top-light/bottom-shade overlay. No clean
     shadcn equivalent, so a minimal token-styled mark stands in. Kept identical
     in recipe across Sidebar / LiveSessionRow / StoredSessionRow / SessionTabs. */
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
  .tm svg {
    width: 8px;
    height: 8px;
    display: block;
    stroke: var(--mark-glyph);
    color: var(--mark-glyph);
    stroke-width: 1.8;
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

  .tab:focus-visible,
  .tl:focus-visible,
  .tclose:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
