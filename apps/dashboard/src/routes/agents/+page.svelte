<script lang="ts">
  import AgentCard from '$lib/components/AgentCard.svelte';
  import { EmptyState, Card } from '$lib/components/ui';
  import { agents } from '$lib/stores/realtime.svelte';
  import { Server, Terminal, Copy, Check, ArrowUpRight } from 'lucide-svelte';

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
    { value: 'all' as const, label: 'All', count: agentsList.length },
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

<div class="p-8 max-w-[1400px] mx-auto animate-fade-in">
  <!-- Header -->
  <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
    <div>
      <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.2em] mb-2 block">Infrastructure</span>
      <h1 class="text-4xl font-serif font-bold text-text tracking-tight">Agents</h1>
      <div class="flex items-center gap-4 mt-2">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-success animate-pulse"></span>
          <span class="text-sm text-text-secondary">{onlineCount} online</span>
        </div>
        <span class="text-border">|</span>
        <span class="text-sm text-text-secondary">{totalInstances} active {totalInstances === 1 ? 'instance' : 'instances'}</span>
      </div>
    </div>
  </header>

  <!-- Filters -->
  <div class="bg-surface border border-border mb-6">
    <div class="p-4 border-b border-border">
      <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.15em]">Status Filter</span>
    </div>
    <div class="p-4 flex flex-wrap gap-2">
      {#each filterButtons as filter}
        <button
          class="px-4 py-2 text-xs font-mono uppercase tracking-wider transition-all duration-150 flex items-center gap-2
                 {statusFilter === filter.value
                   ? filter.value === 'online' ? 'bg-success text-text-inverse' :
                     filter.value === 'offline' ? 'bg-text-muted text-text-inverse' :
                     'bg-primary text-text-inverse'
                   : 'bg-bg-subtle border border-border text-text-secondary hover:border-primary/50 hover:text-text'}"
          onclick={() => statusFilter = filter.value}
        >
          {#if filter.value === 'online'}
            <span class="w-1.5 h-1.5 rounded-full {statusFilter === filter.value ? 'bg-text-inverse' : 'bg-success animate-pulse'}"></span>
          {:else if filter.value === 'offline'}
            <span class="w-1.5 h-1.5 rounded-full {statusFilter === filter.value ? 'bg-text-inverse/60' : 'bg-text-muted'}"></span>
          {/if}
          {filter.label}
          <span class="opacity-60">({filter.count})</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Agents Grid -->
  <div class="bg-surface border border-border mb-10">
    <div class="p-4 border-b border-border flex items-center gap-3">
      <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
      <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.15em]">
        {filteredAgents.length} {filteredAgents.length === 1 ? 'Agent' : 'Agents'}
      </span>
    </div>

    {#if filteredAgents.length > 0}
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-px bg-border">
        {#each filteredAgents as agent (agent.id)}
          <div class="bg-surface p-4">
            <AgentCard {agent} />
          </div>
        {/each}
      </div>
    {:else}
      <div class="p-12">
        <EmptyState
          icon={Server}
          title={statusFilter !== 'all' ? 'No agents found' : 'No agents connected'}
          description={statusFilter !== 'all'
            ? 'Try changing the filter'
            : 'Run "cockpit agent" on your devices to connect them'}
        />
      </div>
    {/if}
  </div>

  <!-- Setup Instructions -->
  <section>
    <div class="bg-surface border border-border relative overflow-hidden">
      <!-- Accent stripe -->
      <div class="absolute top-0 left-0 w-full h-1 bg-accent-blue"></div>

      <div class="p-6">
        <div class="flex items-center gap-3 mb-6">
          <div class="w-1.5 h-1.5 rounded-full bg-accent-blue"></div>
          <h2 class="text-[11px] font-mono text-text-muted uppercase tracking-[0.15em]">Connect a New Agent</h2>
        </div>

        <div class="space-y-6">
          <p class="text-sm text-text-secondary">
            To connect a new device, install the Cockpit CLI and run the agent command:
          </p>

          <div class="relative">
            <div class="bg-bg-subtle border border-border p-5 font-mono text-sm">
              <div class="text-text-muted text-xs uppercase tracking-wider mb-2"># Install cockpit CLI</div>
              <div class="text-text mb-4">bun install -g @cockpit/cli</div>

              <div class="text-text-muted text-xs uppercase tracking-wider mb-2"># Start the agent</div>
              <div class="text-text">cockpit agent</div>
            </div>

            <button
              class="absolute top-3 right-3 p-2 bg-surface border border-border
                     hover:border-primary/50 transition-colors"
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

          <div class="flex items-start gap-4 text-sm">
            <div class="w-8 h-8 bg-primary flex items-center justify-center flex-shrink-0">
              <Terminal class="w-4 h-4 text-text-inverse" />
            </div>
            <p class="text-text-secondary">
              The agent will automatically discover the hub via mDNS on your Tailscale network.
              You can also specify a hub URL directly: <code class="bg-bg-subtle border border-border px-2 py-0.5 text-xs font-mono">cockpit agent --hub http://hub-ip:3456</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</div>
