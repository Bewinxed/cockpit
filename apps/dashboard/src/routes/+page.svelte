<script lang="ts">
  import StatsCard from '$lib/components/StatsCard.svelte';
  import InstanceCard from '$lib/components/InstanceCard.svelte';
  import AgentCard from '$lib/components/AgentCard.svelte';
  import NewInstanceModal from '$lib/components/NewInstanceModal.svelte';
  import { Button, Card, EmptyState } from '$lib/components/ui';
  import {
    stats,
    recentInstances,
    onlineAgents,
    connectionStatus
  } from '$lib/stores/realtime.svelte';
  import {
    Terminal,
    Server,
    CheckCircle,
    DollarSign,
    Plus,
    ArrowUpRight,
    Zap,
    MessageSquare
  } from 'lucide-svelte';

  let showNewInstanceModal = $state(false);

  // Format cost from stats
  const formattedCost = $derived(
    $stats.totalCostUsd > 0 ? `$${$stats.totalCostUsd.toFixed(2)}` : '$0.00'
  );
</script>

<svelte:head>
  <title>Dashboard | Cockpit</title>
</svelte:head>

<div class="p-8 max-w-[1400px] mx-auto animate-fade-in">
  <!-- Header -->
  <header class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10">
    <div>
      <span class="text-[10px] font-mono text-text-muted uppercase tracking-[0.2em] mb-2 block">Overview</span>
      <h1 class="text-4xl font-serif font-bold text-text tracking-tight">Dashboard</h1>
      <p class="text-text-secondary mt-2 text-sm">Manage your Claude Code instances across all devices</p>
    </div>
    <Button variant="primary" onclick={() => showNewInstanceModal = true}>
      <Plus class="size-4" />
      New Instance
    </Button>
  </header>

  <NewInstanceModal bind:open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />

  <!-- Stats Grid -->
  <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
    <StatsCard
      icon={Terminal}
      count={$stats.runningInstances}
      label="Active Instances"
      trend="{$stats.totalInstances} total"
      color="primary"
    />
    <StatsCard
      icon={Server}
      count={$stats.onlineAgents}
      label="Connected Agents"
      trend="{$stats.totalAgents} total"
      color="success"
    />
    <StatsCard
      icon={CheckCircle}
      count={$stats.activeTasks}
      label="Active Tasks"
      trend="In progress"
      color="info"
    />
    <StatsCard
      icon={DollarSign}
      count={formattedCost}
      label="Total Cost"
      trend="All time"
      color="warning"
    />
  </section>

  <!-- Content Grid -->
  <div class="grid grid-cols-1 lg:grid-cols-5 gap-6">
    <!-- Recent Instances -->
    <section class="lg:col-span-3">
      <div class="bg-surface border border-border">
        <div class="flex justify-between items-center p-5 border-b border-border">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full bg-primary"></div>
            <h2 class="text-[11px] font-mono text-text-muted uppercase tracking-[0.15em]">Recent Instances</h2>
          </div>
          <a href="/instances" class="group text-[11px] font-mono text-text-secondary hover:text-primary transition-colors flex items-center gap-1 uppercase tracking-wider">
            View all
            <ArrowUpRight class="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </a>
        </div>

        <div class="divide-y divide-border">
          {#each $recentInstances as instance (instance.id)}
            <div class="p-4">
              <InstanceCard {instance} compact />
            </div>
          {:else}
            <div class="p-8">
              <EmptyState
                icon={MessageSquare}
                title="No instances yet"
                description="Start a new instance to begin working with Claude Code"
                size="sm"
                action={{ label: 'New Instance', onClick: () => showNewInstanceModal = true }}
              />
            </div>
          {/each}
        </div>
      </div>
    </section>

    <!-- Connected Agents -->
    <section class="lg:col-span-2">
      <div class="bg-surface border border-border">
        <div class="flex justify-between items-center p-5 border-b border-border">
          <div class="flex items-center gap-3">
            <div class="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></div>
            <h2 class="text-[11px] font-mono text-text-muted uppercase tracking-[0.15em]">Connected Agents</h2>
          </div>
          <a href="/agents" class="group text-[11px] font-mono text-text-secondary hover:text-primary transition-colors flex items-center gap-1 uppercase tracking-wider">
            View all
            <ArrowUpRight class="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </a>
        </div>

        <div class="divide-y divide-border">
          {#each $onlineAgents as agent (agent.id)}
            <div class="p-4">
              <AgentCard {agent} compact />
            </div>
          {:else}
            <div class="p-8">
              <EmptyState
                icon={Server}
                title="No agents connected"
                description="Run 'cockpit agent' on a device to connect it"
                size="sm"
              />
            </div>
          {/each}
        </div>
      </div>
    </section>
  </div>

  <!-- Quick Start Guide (shown when no activity) -->
  {#if $stats.totalInstances === 0 && $stats.totalAgents === 0}
    <section class="mt-10">
      <div class="bg-surface border border-border relative overflow-hidden">
        <!-- Accent stripe -->
        <div class="absolute top-0 left-0 w-full h-1 bg-accent-blue"></div>

        <div class="p-6">
          <div class="flex items-start gap-5">
            <div class="w-12 h-12 bg-primary flex items-center justify-center flex-shrink-0">
              <Zap class="w-6 h-6 text-text-inverse" />
            </div>
            <div class="flex-1">
              <h3 class="font-serif font-bold text-xl text-text mb-2">Get Started with Cockpit</h3>
              <p class="text-sm text-text-secondary mb-6">
                Cockpit lets you manage Claude Code instances across multiple machines. Here's how to get started:
              </p>
              <div class="space-y-4">
                <div class="flex items-start gap-4">
                  <span class="w-8 h-8 bg-primary text-text-inverse flex items-center justify-center text-sm font-mono font-bold flex-shrink-0">01</span>
                  <div>
                    <p class="text-sm font-medium text-text mb-1">Start an agent on your machine</p>
                    <code class="text-xs font-mono bg-bg-subtle px-3 py-1.5 inline-block text-text-secondary border border-border">cockpit agent</code>
                  </div>
                </div>
                <div class="flex items-start gap-4">
                  <span class="w-8 h-8 bg-primary text-text-inverse flex items-center justify-center text-sm font-mono font-bold flex-shrink-0">02</span>
                  <div>
                    <p class="text-sm font-medium text-text mb-1">Create a new instance</p>
                    <p class="text-xs text-text-secondary">Click "New Instance" to spawn a Claude Code session</p>
                  </div>
                </div>
                <div class="flex items-start gap-4">
                  <span class="w-8 h-8 bg-primary text-text-inverse flex items-center justify-center text-sm font-mono font-bold flex-shrink-0">03</span>
                  <div>
                    <p class="text-sm font-medium text-text mb-1">Chat with Claude</p>
                    <p class="text-xs text-text-secondary">Send messages and watch Claude work on your code</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  {/if}

  <!-- Connection Status Toast -->
  {#if $connectionStatus !== 'connected'}
    <div class="fixed bottom-6 right-6 animate-fade-in-up z-50">
      <div class="bg-surface border border-border p-4 flex items-center gap-3 shadow-lg {
        $connectionStatus === 'connecting' ? 'border-l-4 border-l-warning' :
        $connectionStatus === 'error' ? 'border-l-4 border-l-error' :
        'border-l-4 border-l-text-muted'
      }">
        {#if $connectionStatus === 'connecting'}
          <div class="w-2 h-2 rounded-full bg-warning animate-pulse"></div>
          <span class="text-xs font-mono text-warning uppercase tracking-wider">Connecting...</span>
        {:else if $connectionStatus === 'error'}
          <div class="w-2 h-2 rounded-full bg-error"></div>
          <span class="text-xs font-mono text-error uppercase tracking-wider">Connection Error</span>
        {:else}
          <div class="w-2 h-2 rounded-full bg-text-muted"></div>
          <span class="text-xs font-mono text-text-muted uppercase tracking-wider">Disconnected</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
