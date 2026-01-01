<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import { instances, fetchInstances, connect, disconnect, connectionStatus } from '$lib/stores/realtime';

  const HUB_URL = 'http://localhost:3456';

  onMount(() => {
    connect(HUB_URL);
    fetchInstances(HUB_URL);
  });

  onDestroy(() => {
    disconnect();
  });

  let statusFilter = 'all';
  let searchQuery = '';

  // Get instances as array from Map store
  $: instancesList = Array.from($instances.values());

  $: filteredInstances = instancesList.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          i.agent.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  $: runningCount = instancesList.filter(i => i.status === 'running').length;
  $: stoppedCount = instancesList.filter(i => i.status === 'stopped').length;
</script>

<svelte:head>
  <title>Instances | Cockpit</title>
</svelte:head>

<div class="max-w-6xl">
  <header class="flex justify-between items-start mb-8">
    <div>
      <h1 class="text-2xl font-semibold text-tx-1 mb-1">Instances</h1>
      <p class="text-sm text-tx-3">
        {runningCount} running, {stoppedCount} stopped
      </p>
    </div>
    <button class="btn btn-primary">
      <span>+</span>
      New Instance
    </button>
  </header>

  <!-- Filters -->
  <div class="flex gap-4 mb-6">
    <input
      type="text"
      placeholder="Search instances..."
      bind:value={searchQuery}
      class="flex-1 max-w-md px-4 py-2.5 rounded-xl bg-bg-2 border border-ui-1 text-tx-1
             placeholder:text-tx-3 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20
             transition-all"
    />

    <div class="flex gap-2">
      <button
        class="px-4 py-2 rounded-xl text-sm font-medium transition-all
               {statusFilter === 'all' ? 'bg-primary text-white' : 'bg-bg-2 text-tx-2 hover:bg-bg-3'}"
        onclick={() => statusFilter = 'all'}
      >
        All
      </button>
      <button
        class="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2
               {statusFilter === 'running' ? 'bg-flexoki-green/20 text-flexoki-green' : 'bg-bg-2 text-tx-2 hover:bg-bg-3'}"
        onclick={() => statusFilter = 'running'}
      >
        <span class="w-2 h-2 rounded-full bg-flexoki-green"></span>
        Running
      </button>
      <button
        class="px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2
               {statusFilter === 'stopped' ? 'bg-tx-3/20 text-tx-2' : 'bg-bg-2 text-tx-2 hover:bg-bg-3'}"
        onclick={() => statusFilter = 'stopped'}
      >
        <span class="w-2 h-2 rounded-full bg-tx-3"></span>
        Stopped
      </button>
    </div>
  </div>

  <!-- Instances List -->
  <div class="flex flex-col gap-3">
    {#each filteredInstances as instance}
      <InstanceCard {instance} />
    {/each}
  </div>

  {#if filteredInstances.length === 0}
    <div class="text-center py-12">
      <div class="text-4xl mb-4">
        {searchQuery || statusFilter !== 'all' ? '🔍' : '💭'}
      </div>
      <h3 class="text-lg font-medium text-tx-1 mb-2">
        {searchQuery || statusFilter !== 'all' ? 'No instances found' : 'No instances yet'}
      </h3>
      <p class="text-sm text-tx-3 mb-4">
        {searchQuery || statusFilter !== 'all' ? 'Try adjusting your filters' : 'Start a new Claude Code instance to get going'}
      </p>
      {#if !searchQuery && statusFilter === 'all'}
        <button class="btn btn-primary">Start Instance</button>
      {/if}
    </div>
  {/if}
</div>
