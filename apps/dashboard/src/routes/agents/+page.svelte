<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import AgentCard from '$lib/components/AgentCard.svelte';
  import { agents, fetchAgents, connect, disconnect, connectionStatus } from '$lib/stores/realtime';

  const HUB_URL = 'http://localhost:3456';

  onMount(() => {
    connect(HUB_URL);
    fetchAgents(HUB_URL);
  });

  onDestroy(() => {
    disconnect();
  });

  let statusFilter = 'all';

  // Get agents as array from Map store
  $: agentsList = Array.from($agents.values());

  $: filteredAgents = agentsList.filter(a =>
    statusFilter === 'all' || a.status === statusFilter
  );

  $: onlineCount = agentsList.filter(a => a.status === 'online').length;
  $: totalInstances = agentsList.reduce((sum, a) => sum + a.instances, 0);
</script>

<svelte:head>
  <title>Agents | Cockpit</title>
</svelte:head>

<div class="max-w-6xl">
  <header class="flex justify-between items-start mb-8">
    <div>
      <h1 class="text-2xl font-semibold text-tx-1 mb-1">Agents</h1>
      <p class="text-sm text-tx-3">
        {onlineCount} online, {totalInstances} active {totalInstances === 1 ? 'instance' : 'instances'}
      </p>
    </div>
  </header>

  <!-- Filter -->
  <div class="flex gap-2 mb-6">
    <button
      class="px-4 py-2 rounded-xl text-sm font-medium transition-all
             {statusFilter === 'all' ? 'bg-primary text-white' : 'bg-bg-2 text-tx-2 hover:bg-bg-3'}"
      onclick={() => statusFilter = 'all'}
    >
      All Agents
    </button>
    <button
      class="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2
             {statusFilter === 'online' ? 'bg-flexoki-green/20 text-flexoki-green' : 'bg-bg-2 text-tx-2 hover:bg-bg-3'}"
      onclick={() => statusFilter = 'online'}
    >
      <span class="w-2 h-2 rounded-full bg-flexoki-green animate-pulse"></span>
      Online
    </button>
    <button
      class="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2
             {statusFilter === 'offline' ? 'bg-tx-3/20 text-tx-2' : 'bg-bg-2 text-tx-2 hover:bg-bg-3'}"
      onclick={() => statusFilter = 'offline'}
    >
      <span class="w-2 h-2 rounded-full bg-tx-3"></span>
      Offline
    </button>
  </div>

  <!-- Agents Grid -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
    {#each filteredAgents as agent}
      <AgentCard {agent} />
    {/each}
  </div>

  {#if filteredAgents.length === 0}
    <div class="text-center py-12">
      <div class="text-4xl mb-4">
        {statusFilter !== 'all' ? '🔍' : '🖥️'}
      </div>
      <h3 class="text-lg font-medium text-tx-1 mb-2">
        {statusFilter !== 'all' ? 'No agents found' : 'No agents connected'}
      </h3>
      <p class="text-sm text-tx-3 mb-4">
        {statusFilter !== 'all' ? 'Try changing the filter' : 'Run "cockpit agent" on your devices to connect them'}
      </p>
    </div>
  {/if}

  <!-- Setup Instructions -->
  <section class="mt-12 bg-bg-2 rounded-2xl p-6 border border-ui-1">
    <h2 class="text-base font-semibold text-tx-1 mb-4">Connect a New Agent</h2>
    <div class="space-y-4">
      <p class="text-sm text-tx-2">
        To connect a new device, install the Cockpit CLI and run the agent command:
      </p>
      <div class="bg-bg-3 rounded-xl p-4 font-mono text-sm text-tx-1">
        <div class="text-tx-3 mb-2"># Install cockpit</div>
        <div class="mb-3">bun install -g @cockpit/cli</div>
        <div class="text-tx-3 mb-2"># Start the agent</div>
        <div>cockpit agent</div>
      </div>
      <p class="text-sm text-tx-3">
        The agent will automatically discover the hub via mDNS on your Tailscale network.
      </p>
    </div>
  </section>
</div>
