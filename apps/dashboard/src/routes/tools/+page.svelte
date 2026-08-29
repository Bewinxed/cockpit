<script lang="ts">
  /**
   * What the fleet's machines carry: the workflow CLIs (NEW.md §10), the MCP
   * servers, the skill plugins, the subagents and the shared memory (NEW.md
   * §11). Five panels over one hub read, stacked down the page, because they
   * are five answers to the same question — what can a session started on that
   * machine reach? Tabs hid four of those answers behind a click; the stat row
   * up top is the index that replaces them.
   */
  import { onMount, untrack } from 'svelte';
  import type { FleetAgent, FleetConfig, FleetSkillMeta } from '@cockpit/core';
  import * as Tooltip from '$lib/components/ui/tooltip';
  import * as Card from '$lib/components/ui/card';
  import { cockpit } from '$lib/cockpit/client.svelte';
  import type { FleetMemoryDocRow, FleetMemoryRow } from '$lib/cockpit/fleet';
  import type { FleetHook } from '$lib/cockpit/hooks';
  import FleetAgents from '$lib/cockpit/FleetAgents.svelte';
  import FleetHooks from '$lib/cockpit/FleetHooks.svelte';
  import FleetMcp from '$lib/cockpit/FleetMcp.svelte';
  import FleetMemory from '$lib/cockpit/FleetMemory.svelte';
  import FleetSkills from '$lib/cockpit/FleetSkills.svelte';
  import ToolMatrix from '$lib/cockpit/ToolMatrix.svelte';
  import { orderMachines } from '$lib/cockpit/rail.svelte';
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

  /* Dress shadcn Card as the Quiet Ledger raised panel (--surface-raised,
     --radius-panel, --shadow-lifted) — never the stock bg-card/ring
     shadcn ships. tailwind-merge drops the defaults these override. */
  const panelClass =
    'gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--space-5)] shadow-[var(--shadow-lifted)] ring-0';
  const tileClass =
    'h-full gap-0 overflow-visible rounded-[var(--radius-panel)] bg-[var(--surface-raised)] p-[var(--c-card-pad)] shadow-[var(--shadow-lifted)] ring-0';
</script>

<svelte:head>
  <title>Tools &middot; Outpost</title>
</svelte:head>

<!-- The fleet panels all reach for a tooltip; without an ancestor provider they
     throw on the server, which is what used to leave /tools a 500 on a cold load. -->
<Tooltip.Provider>
<div class="page">
  <!-- The stat tile IS the signature move: a shadcn Card (raised) whose body is a
       sunken hairline well — a number sits *in* something, never on it. -->
  {#snippet stat(label: string, value: string | number, unit?: string)}
    <Card.Root class={tileClass}>
      <div class="well">
        <span class="k">{label}</span>
        <span class="v">{value}</span>
        {#if unit}<span class="u">{unit}</span>{/if}
      </div>
    </Card.Root>
  {/snippet}
  <div class="col">
    <header class="head">
      <h1>Tools</h1>
      <p class="sub">
        Everything a session can reach the moment it starts on one of these machines — the CLIs,
        the servers, the skills, the subagents and the memory they all share.
      </p>
    </header>

    <section class="stats" aria-label="Fleet inventory">
      {@render stat('Tools tracked', data.catalog.length)}
      {@render stat('MCP servers', config.mcp.length)}
      {@render stat('Skills', skills.length)}
      {@render stat('Subagents', agents.length)}
      {@render stat('Hooks', hooks.length)}
      {@render stat('Machines online', online, `of ${machines.length}`)}
    </section>

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

    <Card.Root class={panelClass}>
      <header class="phead">
        <h2>MCP servers</h2>
        <span class="psub">Written to every machine, online now or when it returns</span>
      </header>
      <div class="pbody">
        <FleetMcp servers={config.mcp} {machines} {settling} error={data.fleetError} />
      </div>
    </Card.Root>

    <Card.Root class={panelClass}>
      <header class="phead">
        <h2>Skills &amp; plugins</h2>
        <span class="psub">Fetched once for the fleet, or cloned from a marketplace</span>
      </header>
      <div class="pbody">
        <FleetSkills {config} {skills} {machines} {settling} error={data.fleetError} />
      </div>
    </Card.Root>

    <Card.Root class={panelClass}>
      <header class="phead">
        <h2>Subagents</h2>
        <span class="psub">Markdown files that land in ~/.claude/agents everywhere</span>
      </header>
      <div class="pbody">
        <FleetAgents {agents} {machines} {settling} error={data.fleetError} />
      </div>
    </Card.Root>

    <Card.Root class={panelClass}>
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

    <Card.Root class={panelClass}>
      <header class="phead">
        <h2>Hooks</h2>
        <span class="psub">Scripts and calls run on a session's own lifecycle events</span>
      </header>
      <div class="pbody">
        <FleetHooks {hooks} {machines} {settling} error={data.hooksError} />
      </div>
    </Card.Root>
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
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-4);
  }
  /* The sunken well inside each raised stat Card — the recessed-field signature.
     flex:1 keeps a tile with a unit line the same height as one without. */
  .well {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: var(--c-card-gap);
    justify-content: center;
    background: var(--surface-field);
    border: 1px solid var(--border-hairline);
    border-radius: var(--radius-well);
    padding: var(--c-card-pad);
  }
  .well .k {
    color: var(--ink-label);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .well .v {
    font-size: var(--text-3xl);
    font-weight: var(--weight-strong);
    line-height: var(--leading-numeric);
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .well .u {
    color: var(--ink-muted);
    font-size: var(--text-sm);
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
