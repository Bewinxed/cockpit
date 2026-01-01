<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import StatsCard from '$lib/components/StatsCard.svelte';
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import AgentCard from '$lib/components/AgentCard.svelte';
  import {
    agents,
    instances,
    stats,
    recentInstances,
    onlineAgents,
    connect,
    disconnect,
    fetchAgents,
    fetchInstances,
    connectionStatus
  } from '$lib/stores/realtime';

  const HUB_URL = 'http://localhost:3456';

  onMount(() => {
    // Connect to SSE and fetch initial data
    connect(HUB_URL);
    fetchAgents(HUB_URL);
    fetchInstances(HUB_URL);
  });

  onDestroy(() => {
    disconnect();
  });

  // Reactive stats from store
  $: statsData = {
    instances: { count: $stats.runningInstances, label: 'Active Instances', trend: `${$stats.totalInstances} total` },
    agents: { count: $stats.onlineAgents, label: 'Connected Agents', trend: `${$stats.totalAgents} total` },
    tasks: { count: $stats.activeTasks, label: 'Active Tasks', trend: 'In progress' },
    cost: { value: '$0.00', label: "Today's Cost", trend: 'No usage yet' }
  };
</script>

<svelte:head>
  <title>Dashboard | Cockpit</title>
</svelte:head>

<div class="max-w-6xl">
  <!-- Header -->
  <header class="flex justify-between items-start mb-8">
    <div>
      <h1 class="text-2xl font-semibold text-tx-1 mb-1">Dashboard</h1>
      <p class="text-sm text-tx-3">Manage your Claude Code instances across all devices</p>
    </div>
    <button class="btn btn-primary">
      <span>+</span>
      New Instance
    </button>
  </header>

  <!-- Stats Grid -->
  <section class="grid grid-cols-4 gap-4 mb-8">
    <StatsCard
      icon="○"
      count={statsData.instances.count}
      label={statsData.instances.label}
      trend={statsData.instances.trend}
      color="blue"
    />
    <StatsCard
      icon="●"
      count={statsData.agents.count}
      label={statsData.agents.label}
      trend={statsData.agents.trend}
      color="green"
    />
    <StatsCard
      icon="✓"
      count={statsData.tasks.count}
      label={statsData.tasks.label}
      trend={statsData.tasks.trend}
      color="purple"
    />
    <StatsCard
      icon="◇"
      count={statsData.cost.value}
      label={statsData.cost.label}
      trend={statsData.cost.trend}
      color="orange"
    />
  </section>

  <!-- Content Grid -->
  <div class="grid grid-cols-5 gap-6">
    <!-- Recent Instances -->
    <section class="col-span-3 bg-bg-2 rounded-2xl p-6 border border-ui-1">
      <div class="flex justify-between items-center mb-5">
        <h2 class="text-base font-semibold text-tx-1">Recent Instances</h2>
        <a href="/instances" class="text-sm text-tx-3 hover:text-primary transition-colors">
          View all →
        </a>
      </div>
      <div class="flex flex-col gap-3">
        {#each $recentInstances as instance}
          <InstanceCard {instance} />
        {:else}
          <div class="text-center py-8 text-tx-3">
            <p class="text-2xl mb-2">💭</p>
            <p class="text-sm">No instances yet</p>
            <p class="text-xs mt-1">Start a new instance to get going</p>
          </div>
        {/each}
      </div>
    </section>

    <!-- Connected Agents -->
    <section class="col-span-2 bg-bg-2 rounded-2xl p-6 border border-ui-1">
      <div class="flex justify-between items-center mb-5">
        <h2 class="text-base font-semibold text-tx-1">Connected Agents</h2>
        <a href="/agents" class="text-sm text-tx-3 hover:text-primary transition-colors">
          View all →
        </a>
      </div>
      <div class="flex flex-col gap-3">
        {#each $onlineAgents as agent}
          <AgentCard {agent} />
        {:else}
          <div class="text-center py-8 text-tx-3">
            <p class="text-2xl mb-2">🖥️</p>
            <p class="text-sm">No agents connected</p>
            <p class="text-xs mt-1">Run <code class="bg-bg-3 px-1 rounded">cockpit agent</code> on a device</p>
          </div>
        {/each}
      </div>
    </section>
  </div>

  <!-- Connection Status -->
  {#if $connectionStatus !== 'connected'}
    <div class="fixed bottom-4 right-4 px-4 py-2 rounded-xl text-sm
                {$connectionStatus === 'connecting' ? 'bg-yellow-500/20 text-yellow-600' : ''}
                {$connectionStatus === 'error' ? 'bg-red-500/20 text-red-600' : ''}
                {$connectionStatus === 'disconnected' ? 'bg-tx-3/20 text-tx-2' : ''}">
      {$connectionStatus === 'connecting' ? '🔄 Connecting to hub...' : ''}
      {$connectionStatus === 'error' ? '❌ Connection error' : ''}
      {$connectionStatus === 'disconnected' ? '⚡ Disconnected' : ''}
    </div>
  {/if}
</div>
