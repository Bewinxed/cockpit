<script lang="ts">
  /**
   * What the fleet's machines carry: the workflow CLIs (NEW.md §10), the MCP
   * servers, the skill plugins and the subagents (NEW.md §11). Five tabs over
   * one hub read, because they are five answers to the same question — what can
   * a session started on that machine reach?
   *
   * The tab is a search param so a tab can be linked to, and the load never
   * reads the URL, so switching one costs no request.
   */
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { FleetAgent, FleetConfig, FleetSkillMeta } from '@cockpit/core';
  import * as Tabs from '$lib/components/ui/tabs';
  import { cockpit } from '$lib/cockpit/client.svelte';
  import type { FleetMemoryRow } from '$lib/cockpit/fleet';
  import FleetAgents from '$lib/cockpit/FleetAgents.svelte';
  import FleetMcp from '$lib/cockpit/FleetMcp.svelte';
  import FleetMemory from '$lib/cockpit/FleetMemory.svelte';
  import FleetSkills from '$lib/cockpit/FleetSkills.svelte';
  import ToolMatrix from '$lib/cockpit/ToolMatrix.svelte';
  import { orderMachines } from '$lib/cockpit/rail.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const TAB_LIST = [
    { id: 'tools', label: 'Tools' },
    { id: 'mcp', label: 'MCP servers' },
    { id: 'skills', label: 'Skills & plugins' },
    { id: 'agents', label: 'Agents' },
    { id: 'memory', label: 'Memory' },
  ] as const;

  const tab = $derived(
    TAB_LIST.find((one) => one.id === page.url.searchParams.get('tab'))?.id ?? 'tools'
  );
  const title = $derived(TAB_LIST.find((one) => one.id === tab)?.label ?? 'Tools');

  const machines = $derived(orderMachines(cockpit.machines));

  /**
   * The hub's desired state, re-seeded when `data` changes (e.g. on navigation)
   * while still letting local mutations win between loads.
   */
  let config = $state<FleetConfig>(untrack(() => data.config));
  let skills = $state<FleetSkillMeta[]>(untrack(() => data.skills));
  let agents = $state<FleetAgent[]>(untrack(() => data.agents));
  let memory = $state<FleetMemoryRow | null>(untrack(() => data.memory));

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
    }
  });

  let settling = $state(true);
  onMount(() => {
    const timer = setTimeout(() => (settling = false), 600);
    return () => clearTimeout(timer);
  });

  function switchTab(next: string) {
    void goto(`/tools?tab=${next}`, { noScroll: true, replaceState: true });
  }
</script>

<svelte:head>
  <title>{title} &middot; Outpost</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-6">
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <header>
      <h1 class="text-display">{title}</h1>
    </header>

    <Tabs.Root value={tab} onValueChange={switchTab}>
      <Tabs.List variant="line" class="w-full">
        {#each TAB_LIST as one (one.id)}
          <Tabs.Trigger value={one.id}>{one.label}</Tabs.Trigger>
        {/each}
      </Tabs.List>

      <Tabs.Content value="tools" class="flex flex-col gap-4 pt-4">
        <ToolMatrix
          {machines}
          {settling}
          catalog={data.catalog}
          policies={data.policies}
          error={data.toolsError}
        />
      </Tabs.Content>

      <Tabs.Content value="mcp" class="flex flex-col gap-4 pt-4">
        <FleetMcp servers={config.mcp} {machines} {settling} error={data.fleetError} />
      </Tabs.Content>

      <Tabs.Content value="skills" class="flex flex-col gap-4 pt-4">
        <FleetSkills {config} {skills} {machines} {settling} error={data.fleetError} />
      </Tabs.Content>

      <Tabs.Content value="agents" class="flex flex-col gap-4 pt-4">
        <FleetAgents {agents} {machines} {settling} error={data.fleetError} />
      </Tabs.Content>

      <Tabs.Content value="memory" class="flex flex-col gap-4 pt-4">
        <FleetMemory bind:memory {machines} {settling} error={data.fleetError} />
      </Tabs.Content>
    </Tabs.Root>
  </div>
</div>
