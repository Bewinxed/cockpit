<script lang="ts">
  /**
   * What the fleet's machines carry: MCP servers, skills, subagents, memory,
   * and hooks — one panel visible at a time behind a labelled tab selector,
   * held in the URL (?tab=), with a fleet status line and "needs attention"
   * strip above the tabs so fleet-wide failures are visible without hunting
   * through panels. (JOURNEY.md §4)
   */
  import { onMount, untrack } from 'svelte';
  import type { FleetAgent, FleetConfig, FleetSkillMeta } from '@cockpit/core';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Card from '$lib/components/ui/card';
  import * as Tabs from '$lib/components/ui/tabs';
  import { cockpit } from '$lib/cockpit/client.svelte';
  import type { FleetMemoryDocRow, FleetMemoryRow } from '$lib/cockpit/fleet';
  import type { FleetHook } from '$lib/cockpit/hooks';
  import FleetAgents from '$lib/cockpit/FleetAgents.svelte';
  import FleetHooks from '$lib/cockpit/FleetHooks.svelte';
  import FleetMcp from '$lib/cockpit/FleetMcp.svelte';
  import FleetMemory from '$lib/cockpit/FleetMemory.svelte';
  import FleetSkills from '$lib/cockpit/FleetSkills.svelte';
  import FleetTrouble from '$lib/cockpit/FleetTrouble.svelte';
  import ToolMatrix from '$lib/cockpit/ToolMatrix.svelte';
  import { orderMachines } from '$lib/cockpit/rail.svelte';
  import {
    IconToolGeneric,
    IconToolMcp,
    IconBoltDuo,
    IconSubagentDuo,
    IconBookDuo,
    IconHookDuo,
  } from '$lib/icons';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const machines = $derived(orderMachines(cockpit.machines));
  const online = $derived(machines.filter((one) => one.status === 'online').length);

  /**
   * The hub's desired state, re-seeded when `data` changes (e.g. on navigation)
   * while still letting local mutations win between loads.
   */
  let config = $state<FleetConfig>(untrack(() => data.config));
  let skills = $state<FleetSkillMeta[]>(untrack(() => data.skills));
  let agents = $state<FleetAgent[]>(untrack(() => data.agents));
  let memory = $state<FleetMemoryRow | null>(untrack(() => data.memory));
  let memoryDocs = $state<FleetMemoryDocRow[]>(untrack(() => data.memoryDocs));
  let hooks = $state<FleetHook[]>(untrack(() => data.hooks));

  /** Re-seed from the load when `data` changes on navigation. The identity of
   *  `data.config` is new on every load, so it doubles as a change token.
   *  The latch is $state.raw: a plain $state latch would store a proxy of
   *  `data.config`, the !== check would never settle, and the effect would
   *  loop forever (state_proxy_equality_mismatch — see NEW.md drift log). */
  let seeded = $state.raw(untrack(() => data.config));
  $effect(() => {
    if (data.config !== seeded) {
      seeded = data.config;
      config = data.config;
      skills = data.skills;
      agents = data.agents;
      memory = data.memory;
      memoryDocs = data.memoryDocs;
      hooks = data.hooks;
    }
  });

  let settling = $state(true);
  onMount(() => {
    const timer = setTimeout(() => (settling = false), 600);
    return () => clearTimeout(timer);
  });

  const activeTab = $derived(page.url.searchParams.get('tab') ?? 'tools');

  function switchTab(value: string) {
    const url = new URL(page.url);
    url.searchParams.set('tab', value);
    goto(url.toString(), { noScroll: true, replaceState: true });
  }

  /* Dress shadcn Card as the Quiet Ledger raised panel (--surface-raised,
     --radius-panel, --shadow-lifted) — never the stock bg-card/ring
     shadcn ships. tailwind-merge drops the defaults these override. */
  const panelClass =
    'gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-lifted)] ring-0';
</script>

<svelte:head>
  <title>Tools &middot; Outpost</title>
</svelte:head>

<!-- The fleet panels all reach for a tooltip; without an ancestor provider they
     throw on the server, which is what used to leave /tools a 500 on a cold load. -->
<Tooltip.Provider>
<div class="page">
  <div class="col">
    <header class="head">
      <h1>Tools</h1>
      <p class="sub">
        {online} of {machines.length} machines reported
      </p>
    </header>

    <Card.Root id="fleet-trouble" class="scroll-mt-6 {panelClass}">
      <header class="phead">
        <h2>Needs attention</h2>
        <span class="psub">Everything the fleet could not fetch or could not apply</span>
      </header>
      <div class="pbody">
        <FleetTrouble {machines} {skills} plugins={config.plugins} {settling} />
      </div>
    </Card.Root>

    <Tabs.Root value={activeTab} onValueChange={switchTab}>
      <Tabs.List class="tab-strip" variant="line">
        <Tabs.Trigger value="tools">
          <IconToolGeneric class="tab-icon" /><span class="tab-label">Tools</span> <span class="badge">{data.catalog.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="mcp">
          <IconToolMcp class="tab-icon" /><span class="tab-label">MCP</span> <span class="badge">{config.mcp.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="skills">
          <IconBoltDuo class="tab-icon" /><span class="tab-label">Skills</span> <span class="badge">{skills.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="agents">
          <IconSubagentDuo class="tab-icon" /><span class="tab-label">Agents</span> <span class="badge">{agents.length}</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="memory">
          <IconBookDuo class="tab-icon" /><span class="tab-label">Memory</span>
        </Tabs.Trigger>
        <Tabs.Trigger value="hooks">
          <IconHookDuo class="tab-icon" /><span class="tab-label">Hooks</span> <span class="badge">{hooks.length}</span>
        </Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="tools">
        <Card.Root class={panelClass}>
          <header class="phead">
            <h2>Tool matrix</h2>
            <span class="psub">Workflow CLIs, machine by machine</span>
          </header>
          <div class="pbody">
            <ToolMatrix
              {machines}
              {settling}
              catalog={data.catalog}
              policies={data.policies}
              error={data.toolsError}
            />
          </div>
        </Card.Root>
      </Tabs.Content>

      <Tabs.Content value="mcp">
        <Card.Root id="fleet-mcp" class="scroll-mt-6 {panelClass}">
          <header class="phead">
            <h2>MCP servers</h2>
            <span class="psub">Written to every machine, online now or when it returns</span>
          </header>
          <div class="pbody">
            <FleetMcp servers={config.mcp} {machines} {settling} error={data.fleetError} />
          </div>
        </Card.Root>
      </Tabs.Content>

      <Tabs.Content value="skills">
        <Card.Root id="fleet-skills" class="scroll-mt-6 {panelClass}">
          <header class="phead">
            <h2>Skills &amp; plugins</h2>
            <span class="psub">Fetched once for the fleet, or cloned from a marketplace</span>
          </header>
          <div class="pbody">
            <FleetSkills {config} {skills} {machines} {settling} error={data.fleetError} />
          </div>
        </Card.Root>
      </Tabs.Content>

      <Tabs.Content value="agents">
        <Card.Root class={panelClass}>
          <header class="phead">
            <h2>Subagents</h2>
            <span class="psub">Markdown files that land in ~/.claude/agents everywhere</span>
          </header>
          <div class="pbody">
            <FleetAgents {agents} {machines} {settling} error={data.fleetError} />
          </div>
        </Card.Root>
      </Tabs.Content>

      <Tabs.Content value="memory">
        <Card.Root id="fleet-memory" class="scroll-mt-6 {panelClass}">
          <header class="phead">
            <h2>Memory</h2>
            <span class="psub">The user CLAUDE.md the whole fleet reads</span>
          </header>
          <div class="pbody">
            <FleetMemory
              bind:memory
              bind:docs={memoryDocs}
              {machines}
              {settling}
              error={data.fleetError}
            />
          </div>
        </Card.Root>
      </Tabs.Content>

      <Tabs.Content value="hooks">
        <Card.Root id="fleet-hooks" class="scroll-mt-6 {panelClass}">
          <header class="phead">
            <h2>Hooks</h2>
            <span class="psub">Scripts and calls run on a session's own lifecycle events</span>
          </header>
          <div class="pbody">
            <FleetHooks {hooks} {machines} {settling} error={data.hooksError} />
          </div>
        </Card.Root>
      </Tabs.Content>
    </Tabs.Root>
  </div>
</div>
</Tooltip.Provider>

<style>
  .page {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-6);
    min-width: 0;
  }
  .col {
    margin: 0 auto;
    max-width: 1100px;
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }
  .head {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .head h1 {
    font-size: var(--text-2xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-tight);
    letter-spacing: var(--track-display);
    color: var(--ink-strong);
  }
  .head .sub {
    max-width: 68ch;
    font-size: var(--text-base);
    color: var(--ink-muted);
  }
  /* Tab strip: horizontally scrollable on narrow viewports with next tab
     peeking past the edge (JOURNEY.md §4 mobile reflow). */
  :global(.tab-strip) {
    width: 100% !important;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    border-bottom: 1px solid var(--border-hairline);
    background: transparent;
  }
  :global(.tab-strip::-webkit-scrollbar) {
    display: none;
  }
  :global(.tab-icon) {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    opacity: 0.6;
  }
  :global([data-state="active"] .tab-icon) {
    opacity: 1;
  }
  .badge {
    color: var(--ink-label);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }
  /* On narrow viewports, hide tab labels — icon + badge is enough.
     The tab strip scrolls horizontally with the next tab peeking
     past the edge (JOURNEY.md §4 mobile reflow). */
  @media (max-width: 639px) {
    .tab-label {
      display: none;
    }
    :global(.tab-icon) {
      width: 18px;
      height: 18px;
    }
  }
  /* Tables inside panels must not overflow the viewport. */
  .pbody {
    overflow-x: auto;
  }
  .pbody :global(table) {
    min-width: 500px;
  }
  .phead {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-1) var(--space-3);
    margin-bottom: var(--space-4);
  }
  .phead h2 {
    font-size: var(--text-md);
    font-weight: var(--weight-strong);
    color: var(--ink-strong);
  }
  .psub {
    font-size: var(--text-sm);
    color: var(--ink-muted);
  }
  .pbody {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
</style>
