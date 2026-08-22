<script lang="ts">
  /**
   * The management rail: what the fleet is, which boxes it runs on, and what is
   * running right now. Ported from mocks/v5-workspace.html (`aside`) — a sunken
   * rail whose only raised things are the active nav item and the cards at the
   * foot.
   */
  import { page } from '$app/state';
  import { NavItem, ItemMark, StatusPill } from '$lib/outpost';
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
      <NavItem
        href="/session"
        active={path.startsWith('/session')}
        count={fleetCount || undefined}
        attn={cockpit.blockedCount > 0}
      >
        {#snippet icon()}<IconBoxDuo />{/snippet}
        Fleet
      </NavItem>
      <NavItem href="/tools" active={path.startsWith('/tools')}>
        {#snippet icon()}<IconTools />{/snippet}
        Tools
      </NavItem>
      <NavItem href="/rules" active={path.startsWith('/rules')}>
        {#snippet icon()}<IconRules />{/snippet}
        Rules
      </NavItem>
      <NavItem href="/usage" active={path.startsWith('/usage')}>
        {#snippet icon()}<IconUsage />{/snippet}
        Usage
      </NavItem>
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
            <ItemMark hue={markHue(row.cwd || row.machineId)}>
              <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
                <path d={harnessGlyphPath(row.harness)} />
              </svg>
            </ItemMark>
            <span class="nm">{sessionName(row)}</span>
            <StatusPill status={PILL[activity]}>{ACTIVITY_LABEL[activity]}</StatusPill>
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
  .row :global(.mark) {
    width: 17px;
    height: 17px;
  }
  .row :global(.mark svg) {
    width: 10px;
    height: 10px;
    stroke-width: 1.8;
  }
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
