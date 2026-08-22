<script lang="ts">
  /**
   * The management rail: what the fleet is, which boxes it runs on, and what is
   * running right now. Ported from mocks/v5-workspace.html (`aside`) — a sunken
   * rail whose only raised things are the active nav item and the cards at the
   * foot.
   */
  import { page } from '$app/state';
  import { Badge } from '$lib/components/ui/badge';
  import { IconBoxDuo, IconRules, IconTools, IconUsage } from '$lib/icons';
  import { ACTIVITY_LABEL, type Activity } from './activity';
  import { cockpit } from './client.svelte';
  import { machineLabel } from './machine';
  import { harnessGlyphPath, markHue } from './mark';
  import MachineMenu from './MachineMenu.svelte';
  import OsMark from './OsMark.svelte';
  import UsageMeter from './UsageMeter.svelte';

  const path = $derived(page.url.pathname);

  /** The rail's own wording for a session that never carried a title. */
  const sessionName = (row: { title?: string | null; cwd: string; id: string }): string =>
    row.title?.trim() || row.cwd.split('/').filter(Boolean).pop() || row.id.slice(0, 8);

  /** Blocked wins the Fleet pill: it is the only count anyone acts on. */
  const fleetCount = $derived(cockpit.blockedCount || cockpit.runningInstances.length);

  const online = $derived(new Set(cockpit.onlineMachines.map((machine) => machine.machineId)));

  const PILL: Record<Activity, 'live' | 'attn' | 'idle'> = {
    working: 'live',
    blocked: 'attn',
    idle: 'idle',
  };

  /** StatusPill ported to ui/badge, token-dressed to the Quiet Ledger pill
   *  recipe: a tint carries live/attn, idle carries NO fill (bare muted label). */
  const PILL_FILL: Record<string, string> = {
    live: 'bg-[var(--status-live-bg)] text-[var(--status-live-ink)]',
    attn: 'bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]',
    done: 'bg-[var(--status-done-bg)] text-[var(--status-done-ink)]',
    fail: 'bg-[var(--status-fail-bg)] text-[var(--status-fail-ink)]',
  };
  function pillClass(status: 'live' | 'attn' | 'done' | 'fail' | 'idle'): string {
    const base =
      'h-[var(--c-pill-h)] rounded-[var(--radius-pill)] border-0 text-[length:var(--c-pill-fs)] leading-none whitespace-nowrap';
    return status === 'idle'
      ? `${base} gap-0 bg-transparent p-0 font-[450] text-[var(--status-idle-ink)]`
      : `${base} gap-[var(--c-pill-gap)] px-2.5 py-0 font-medium ${PILL_FILL[status]}`;
  }

  /** The NavItem count pill, as a token-dressed ui/badge: the fleet count on the
   *  live tint, or the attention tint while a session is blocked. */
  function countClass(attn: boolean): string {
    const tint = attn
      ? 'bg-[var(--status-attn-bg)] text-[var(--status-attn-ink)]'
      : 'bg-[var(--status-live-bg)] text-[var(--status-live-ink)]';
    return `ml-auto rounded-[var(--radius-pill)] border-0 px-[7px] py-[3px] text-[length:var(--text-sm)] font-medium leading-none ${tint}`;
  }
</script>

<div class="rail">
  <a class="brand" href="/session">
    <span class="logo" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7">
        <path d="M4 4h16v16H4z" />
        <path d="M4 4h8v16H4z" fill="currentColor" />
      </svg>
    </span>
    <b>Outpost</b>
  </a>

  <div class="body">
    <div class="sec">Fleet</div>
    <nav aria-label="Fleet">
      {#snippet navItem(href: string, active: boolean, label: string, icon: import('svelte').Snippet, count?: number, attn = false)}
        <a class="nav-i" class:on={active} {href} aria-current={active ? 'page' : undefined}>
          <span class="ic">{@render icon()}</span>
          <span class="lbl">{label}</span>
          {#if count !== undefined && count !== null}
            <Badge class={countClass(attn)}>{count}</Badge>
          {/if}
        </a>
      {/snippet}
      {#snippet boxIcon()}<IconBoxDuo />{/snippet}
      {#snippet toolsIcon()}<IconTools />{/snippet}
      {#snippet rulesIcon()}<IconRules />{/snippet}
      {#snippet usageIcon()}<IconUsage />{/snippet}
      {@render navItem(
        '/session',
        path.startsWith('/session'),
        'Fleet',
        boxIcon,
        fleetCount || undefined,
        cockpit.blockedCount > 0
      )}
      {@render navItem('/tools', path.startsWith('/tools'), 'Tools', toolsIcon)}
      {@render navItem('/rules', path.startsWith('/rules'), 'Rules', rulesIcon)}
      {@render navItem('/usage', path.startsWith('/usage'), 'Usage', usageIcon)}
    </nav>

    {#if cockpit.machines.length > 0}
      <div class="sec">Machines</div>
      <div class="rows" role="list">
        {#each cockpit.machines as machine (machine.machineId)}
          <MachineMenu {machine}>
            <div class="row machine" role="listitem">
              <OsMark os={machine.os} class="os" />
              <span class="nm">{machineLabel(machine.hostname)}</span>
              <span
                class="dot {online.has(machine.machineId) ? 'up' : ''}"
                title={online.has(machine.machineId) ? 'Online' : 'Offline'}
              ></span>
            </div>
          </MachineMenu>
        {/each}
      </div>
    {/if}

    {#if cockpit.runningInstances.length > 0}
      <div class="sec">Running now</div>
      <div class="rows">
        {#each cockpit.runningInstances as row (row.id)}
          {@const activity = cockpit.activityOf(row.id)}
          <a class="row" class:on={path === `/session/${row.id}`} href="/session/{row.id}">
            <span class="mark m{markHue(row.cwd || row.machineId)}">
              <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path d={harnessGlyphPath(row.harness)} />
              </svg>
            </span>
            <span class="nm">{sessionName(row)}</span>
            <Badge class={pillClass(PILL[activity])}>{ACTIVITY_LABEL[activity]}</Badge>
          </a>
        {/each}
      </div>
    {/if}
  </div>

  <div class="foot">
    <UsageMeter />
    <div class="me">
      <span class="av" aria-hidden="true">bw</span>
      <span class="who">
        <span class="nm">bewinxed</span>
        <span class="em">{cockpit.machines.length} machines</span>
      </span>
    </div>
  </div>
</div>

<style>
  .rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--surface-sunken);
    overflow: hidden;
  }

  .brand {
    height: 57px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 var(--space-4);
    text-decoration: none;
    color: var(--ink-strong);
  }
  .logo {
    width: 26px;
    height: 26px;
    border-radius: var(--radius-well);
    background: var(--brand-solid);
    background-image: var(--gradient-action);
    box-shadow: var(--shadow-action);
    color: var(--on-brand);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .logo svg {
    width: 15px;
    height: 15px;
    display: block;
  }
  .brand b {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    letter-spacing: var(--track-display);
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding-bottom: var(--space-4);
  }

  .sec {
    font-size: var(--text-xs);
    color: var(--ink-muted);
    font-weight: var(--weight-strong);
    text-transform: uppercase;
    letter-spacing: var(--track-caps);
    padding: 0 var(--space-6);
    margin: var(--space-4) 0 var(--space-2);
  }

  nav,
  .rows {
    padding: 0 10px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  /* NavItem ported to a token-styled anchor matching mock .nav-i (ui/sidebar's
     sidebar-menu-button needs a SidebarProvider this rail does not mount, so the
     token anchor is the clean fit). Active = raised fill on the sunken rail. */
  .nav-i {
    height: var(--c-nav-h);
    border-radius: var(--radius-control);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 10px;
    font-size: var(--text-md);
    color: var(--ink-body);
    font-weight: var(--weight-medium);
    text-decoration: none;
  }
  .nav-i .ic {
    width: 18px;
    flex: 0 0 auto;
    color: var(--ink-muted);
    display: grid;
    place-items: center;
  }
  .nav-i .ic :global(svg) {
    width: 16px;
    height: 16px;
    display: block;
  }
  .nav-i .lbl {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nav-i.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    box-shadow: var(--shadow-tile);
    font-weight: var(--weight-strong);
  }
  .nav-i.on .ic {
    color: var(--ink-body);
  }
  @media (hover: hover) and (pointer: fine) {
    .nav-i:hover {
      background: var(--surface-hover);
    }
    .nav-i.on:hover {
      background: var(--surface-raised);
    }
    .nav-i:active {
      background: var(--surface-active);
    }
  }
  .nav-i:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-control);
  }

  .row {
    height: 30px;
    border-radius: var(--radius-tile);
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0 10px;
    font-size: var(--text-base);
    color: var(--ink-body);
    font-weight: var(--weight-medium);
    text-decoration: none;
    min-width: 0;
  }
  .row.on {
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: var(--weight-strong);
    box-shadow: var(--shadow-tile);
  }
  .row .nm {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row :global(.os) {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: var(--ink-muted);
  }

  /* Item mark — inlined token primitive (17px running-now recipe): identity hue
     + harness glyph, top-light/bottom-shade overlay. No clean shadcn equivalent;
     kept identical in recipe across the four sidebar-cluster files. */
  .mark {
    width: 17px;
    height: 17px;
    border-radius: var(--radius-mark);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    background-image: var(--mark-overlay);
    background-color: var(--mark-1);
  }
  .mark svg {
    width: 10px;
    height: 10px;
    display: block;
    color: var(--mark-glyph);
    stroke: var(--mark-glyph);
    stroke-width: 1.8;
  }
  .mark.m2 { background-color: var(--mark-2); }
  .mark.m3 { background-color: var(--mark-3); }
  .mark.m4 { background-color: var(--mark-4); }
  .mark.m5 { background-color: var(--mark-5); }
  .mark.m6 { background-color: var(--mark-6); }
  .mark.m7 { background-color: var(--mark-7); }
  .mark.m8 { background-color: var(--mark-8); }
  @media (hover: hover) and (pointer: fine) {
    .row:hover {
      background: var(--surface-hover);
    }
  }
  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .machine {
    cursor: default;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-pill);
    flex: 0 0 auto;
    background: var(--border-control);
  }
  .dot.up {
    background: var(--status-done-ink);
  }

  .foot {
    flex: 0 0 auto;
    padding: 0 10px;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .me {
    border-top: 1px solid var(--border-hairline);
    height: 60px;
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: var(--space-1);
  }
  .av {
    width: 31px;
    height: 31px;
    border-radius: var(--radius-pill);
    background: var(--surface-raised);
    box-shadow: var(--shadow-tile);
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--ink-body);
  }
  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .me .nm {
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    line-height: 1.25;
    color: var(--ink-strong);
  }
  .me .em {
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
</style>
