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
    ArrowRight,
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

<div class="page-container animate-fade-in">
  <!-- Header -->
  <header class="page-header">
    <div>
      <h1 class="page-title">Dashboard</h1>
      <p class="page-description">Manage your Claude Code instances across all devices</p>
    </div>
    <Button variant="default" onclick={() => showNewInstanceModal = true}>
      <Plus class="size-4" />
      New Instance
    </Button>
  </header>

  <NewInstanceModal bind:open={showNewInstanceModal} onClose={() => showNewInstanceModal = false} />

  <!-- Stats Grid -->
  <section class="grid-stats mb-8">
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
      color="secondary"
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
      <Card padding="lg">
        <div class="flex justify-between items-center mb-5">
          <h2 class="section-title mb-0">Recent Instances</h2>
          <a href="/instances" class="group text-sm text-text-secondary hover:text-text transition-colors flex items-center gap-1">
            View all
            <ArrowRight class="w-4 h-4 arrow-slide" />
          </a>
        </div>

        <div class="space-y-3">
          {#each $recentInstances as instance (instance.id)}
            <InstanceCard {instance} compact />
          {:else}
            <EmptyState
              icon={MessageSquare}
              title="No instances yet"
              description="Start a new instance to begin working with Claude Code"
              size="sm"
              action={{ label: 'New Instance', onClick: () => showNewInstanceModal = true }}
            />
          {/each}
        </div>
      </Card>
    </section>

    <!-- Connected Agents -->
    <section class="lg:col-span-2">
      <Card padding="lg">
        <div class="flex justify-between items-center mb-5">
          <h2 class="section-title mb-0">Connected Agents</h2>
          <a href="/agents" class="group text-sm text-text-secondary hover:text-text transition-colors flex items-center gap-1">
            View all
            <ArrowRight class="w-4 h-4 arrow-slide" />
          </a>
        </div>

        <div class="space-y-3">
          {#each $onlineAgents as agent (agent.id)}
            <AgentCard {agent} compact />
          {:else}
            <EmptyState
              icon={Server}
              title="No agents connected"
              description="Run 'cockpit agent' on a device to connect it"
              size="sm"
            />
          {/each}
        </div>
      </Card>
    </section>
  </div>

  <!-- Quick Start Guide (shown when no activity) -->
  {#if $stats.totalInstances === 0 && $stats.totalAgents === 0}
    <section class="mt-8">
      <Card padding="lg" class="bg-primary-light border-primary/20">
        <div class="flex items-start gap-4">
          <div class="flex items-center justify-center w-12 h-12 rounded-xl bg-primary text-white flex-shrink-0">
            <Zap class="w-6 h-6" />
          </div>
          <div class="flex-1">
            <h3 class="font-semibold text-text mb-2">Get Started with Cockpit</h3>
            <p class="text-sm text-text-secondary mb-4">
              Cockpit lets you manage Claude Code instances across multiple machines. Here's how to get started:
            </p>
            <div class="space-y-3">
              <div class="flex items-start gap-3">
                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex-shrink-0">1</span>
                <div>
                  <p class="text-sm font-medium text-text">Start an agent on your machine</p>
                  <code class="text-xs font-mono bg-surface px-2 py-1 rounded mt-1 inline-block">cockpit agent</code>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex-shrink-0">2</span>
                <div>
                  <p class="text-sm font-medium text-text">Create a new instance</p>
                  <p class="text-xs text-text-secondary">Click "New Instance" to spawn a Claude Code session</p>
                </div>
              </div>
              <div class="flex items-start gap-3">
                <span class="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-white text-xs font-bold flex-shrink-0">3</span>
                <div>
                  <p class="text-sm font-medium text-text">Chat with Claude</p>
                  <p class="text-xs text-text-secondary">Send messages and watch Claude work on your code</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </section>
  {/if}

  <!-- Connection Status Toast -->
  {#if $connectionStatus !== 'connected'}
    <div class="fixed bottom-6 right-6 animate-fade-in-up">
      <Card padding="sm" class="flex items-center gap-3 shadow-lg {
        $connectionStatus === 'connecting' ? 'border-warning' :
        $connectionStatus === 'error' ? 'border-error' :
        'border-border'
      }">
        {#if $connectionStatus === 'connecting'}
          <div class="w-2 h-2 rounded-full bg-warning animate-pulse-soft"></div>
          <span class="text-sm text-warning">Connecting to hub...</span>
        {:else if $connectionStatus === 'error'}
          <div class="w-2 h-2 rounded-full bg-error"></div>
          <span class="text-sm text-error">Connection error</span>
        {:else}
          <div class="w-2 h-2 rounded-full bg-text-muted"></div>
          <span class="text-sm text-text-secondary">Disconnected</span>
        {/if}
      </Card>
    </div>
  {/if}
</div>
