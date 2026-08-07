<script lang="ts">
  /**
   * What the fleet's machines carry: the workflow CLIs (NEW.md §10), the MCP
   * servers, and the skill plugins (NEW.md §11). Three tabs over one hub read,
   * because they are three answers to the same question — what can a session
   * started on that machine reach?
   *
   * The tab is a search param so a tab can be linked to, and the load never
   * reads the URL, so switching one costs no request.
   */
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import type { FleetConfig, FleetSkillMeta } from '@cockpit/core';
  import { cockpit } from '$lib/cockpit/client.svelte';
  import type { FleetMemoryRow } from '$lib/cockpit/fleet';
  import FleetMcp from '$lib/cockpit/FleetMcp.svelte';
  import FleetMemory from '$lib/cockpit/FleetMemory.svelte';
  import FleetSkills from '$lib/cockpit/FleetSkills.svelte';
  import ToolMatrix from '$lib/cockpit/ToolMatrix.svelte';
  import { orderMachines } from '$lib/cockpit/rail.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const TABS = [
    { id: 'tools', label: 'Tools' },
    { id: 'mcp', label: 'MCP servers' },
    { id: 'skills', label: 'Skills & plugins' },
    { id: 'memory', label: 'Memory' },
  ] as const;

  const tab = $derived(
    TABS.find((one) => one.id === page.url.searchParams.get('tab'))?.id ?? 'tools'
  );
  const title = $derived(TABS.find((one) => one.id === tab)?.label ?? 'Tools');

  /** The rail's arrangement, so the machines read in the order the reader put them. */
  const machines = $derived(orderMachines(cockpit.machines));

  /**
   * The hub's desired state, held here so a write on one tab is still there when
   * the other is opened. This page is its only writer.
   */
  const config = $state<FleetConfig>(untrack(() => data.config));

  /** The directly-fetched skills, held the same way and beside the config. */
  const skills = $state<FleetSkillMeta[]>(untrack(() => data.skills));

  /** The fleet's memory row — one document, so it is replaced rather than mutated. */
  let memory = $state<FleetMemoryRow | null>(untrack(() => data.memory));

  /**
   * Machines arrive over the socket a beat after the page paints, and "no
   * machines" is a sentence worth being sure about before saying it.
   */
  let settling = $state(true);
  onMount(() => {
    const timer = setTimeout(() => (settling = false), 600);
    return () => clearTimeout(timer);
  });
</script>

<svelte:head>
  <title>{title} · Cockpit</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <div class="mx-auto flex max-w-5xl flex-col gap-4">
    <header class="flex items-baseline justify-between">
      <h1 class="text-lg font-semibold">Tools</h1>
      <span class="text-xs text-muted-foreground">hub {cockpit.status}</span>
    </header>

    <nav class="-mb-px flex gap-4 border-b border-border" aria-label="Fleet setup">
      {#each TABS as one (one.id)}
        {@const current = one.id === tab}
        <a
          href="/tools?tab={one.id}"
          data-sveltekit-noscroll
          aria-current={current ? 'page' : undefined}
          class="-mb-px border-b-2 pb-2 text-[13px] transition-colors
                 {current
            ? 'border-foreground font-medium text-foreground'
            : 'border-transparent text-muted-foreground hover:text-foreground'}"
        >
          {one.label}
        </a>
      {/each}
    </nav>

    {#if tab === 'mcp'}
      <FleetMcp servers={config.mcp} {machines} {settling} error={data.fleetError} />
    {:else if tab === 'skills'}
      <FleetSkills {config} {skills} {machines} {settling} error={data.fleetError} />
    {:else if tab === 'memory'}
      <FleetMemory bind:memory {machines} {settling} error={data.fleetError} />
    {:else}
      <ToolMatrix
        {machines}
        {settling}
        catalog={data.catalog}
        policies={data.policies}
        error={data.toolsError}
      />
    {/if}
  </div>
</div>
