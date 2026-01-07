<script lang="ts">
  import AgentCard from '$lib/components/AgentCard.svelte';
  import { EmptyState, Card } from '$lib/components/ui';
  import { agents } from '$lib/stores/realtime.svelte';
  import { Server, Terminal, Copy, Check } from 'lucide-svelte';

  let statusFilter = $state<'all' | 'online' | 'offline'>('all');
  let copied = $state(false);

  // Get agents as array from Map store
  let agentsList = $derived(Array.from($agents.values()));

  let filteredAgents = $derived(
    agentsList
      .filter((a) => statusFilter === 'all' || a.status === statusFilter)
      .sort((a, b) => {
        // Online agents first, then by name
        if (a.status === 'online' && b.status !== 'online') return -1;
        if (a.status !== 'online' && b.status === 'online') return 1;
        return a.name.localeCompare(b.name);
      })
  );

  let onlineCount = $derived(agentsList.filter((a) => a.status === 'online').length);
  let totalInstances = $derived(agentsList.reduce((sum, a) => sum + (a.instances || 0), 0));

  const filterButtons = $derived([
    { value: 'all' as const, label: 'All Agents', count: agentsList.length },
    { value: 'online' as const, label: 'Online', count: onlineCount },
    { value: 'offline' as const, label: 'Offline', count: agentsList.length - onlineCount },
  ]);

  async function copyCommand() {
    await navigator.clipboard.writeText('cockpit agent');
    copied = true;
    setTimeout(() => copied = false, 2000);
  }
</script>

<svelte:head>
  <title>Agents | Cockpit</title>
</svelte:head>

<div class="page-container animate-fade-in">
  <!-- Header -->
  <header class="page-header">
    <div>
      <h1 class="page-title">Agents</h1>
      <p class="page-description">
        {onlineCount} online, {totalInstances} active {totalInstances === 1 ? 'instance' : 'instances'}
      </p>
    </div>
  </header>

  <!-- Filter -->
  <div class="flex gap-2 mb-6">
    {#each filterButtons as filter}
      <button
        class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 flex items-center gap-2
               {statusFilter === filter.value
                 ? filter.value === 'online' ? 'bg-success-light text-success-dark' :
                   filter.value === 'offline' ? 'bg-surface-hover text-text-secondary' :
                   'bg-primary text-white'
                 : 'bg-surface border border-border text-text-secondary hover:bg-surface-hover hover:text-text'}"
        onclick={() => statusFilter = filter.value}
      >
        {#if filter.value === 'online'}
          <span class="status-dot status-dot-pulse bg-success"></span>
        {:else if filter.value === 'offline'}
          <span class="status-dot bg-text-muted"></span>
        {/if}
        {filter.label}
        <span class="text-xs opacity-60">({filter.count})</span>
      </button>
    {/each}
  </div>

  <!-- Agents Grid -->
  <div class="grid-cards">
    {#each filteredAgents as agent (agent.id)}
      <AgentCard {agent} />
    {:else}
      <div class="col-span-full">
        <EmptyState
          icon={Server}
          title={statusFilter !== 'all' ? 'No agents found' : 'No agents connected'}
          description={statusFilter !== 'all'
            ? 'Try changing the filter'
            : 'Run "cockpit agent" on your devices to connect them'}
        />
      </div>
    {/each}
  </div>

  <!-- Setup Instructions -->
  <section class="mt-12">
    <Card padding="lg">
      <h2 class="section-title">Connect a New Agent</h2>

      <div class="space-y-4">
        <p class="text-sm text-text-secondary">
          To connect a new device, install the Cockpit CLI and run the agent command:
        </p>

        <div class="relative">
          <div class="bg-bg-subtle rounded-xl p-4 font-mono text-sm">
            <div class="text-text-muted mb-2"># Install cockpit CLI</div>
            <div class="text-text mb-3">bun install -g @cockpit/cli</div>

            <div class="text-text-muted mb-2"># Start the agent</div>
            <div class="text-text">cockpit agent</div>
          </div>

          <button
            class="absolute top-3 right-3 p-2 rounded-lg bg-surface border border-border
                   hover:bg-surface-hover transition-colors"
            onclick={copyCommand}
            title="Copy command"
          >
            {#if copied}
              <Check class="w-4 h-4 text-success" />
            {:else}
              <Copy class="w-4 h-4 text-text-muted" />
            {/if}
          </button>
        </div>

        <div class="flex items-start gap-3 text-sm">
          <div class="w-6 h-6 rounded-full bg-primary-light flex items-center justify-center flex-shrink-0 mt-0.5">
            <Terminal class="w-3.5 h-3.5 text-primary" />
          </div>
          <p class="text-text-secondary">
            The agent will automatically discover the hub via mDNS on your Tailscale network.
            You can also specify a hub URL directly: <code class="bg-surface-hover px-1.5 py-0.5 rounded text-xs">cockpit agent --hub http://hub-ip:3456</code>
          </p>
        </div>
      </div>
    </Card>
  </section>
</div>
