<script lang="ts">
  import InstanceCard from "$lib/components/InstanceCard.svelte";
  import AgentCard from "$lib/components/AgentCard.svelte";
  import NewInstanceModal from "$lib/components/NewInstanceModal.svelte";
  import { Button, EmptyState } from "$lib/components/ui";
  import {
    stats,
    recentInstances,
    onlineAgents,
    connectionStatus,
  } from "$lib/stores/realtime.svelte";
  import {
    Terminal,
    Server,
    Activity,
    DollarSign,
    Plus,
    ChevronRight,
    Zap,
  } from "lucide-svelte";
  import { fly, fade } from 'svelte/transition';

  let showNewInstanceModal = $state(false);

  const formattedCost = $derived(
    $stats.totalCostUsd > 0 ? `$${$stats.totalCostUsd.toFixed(2)}` : "$0.00"
  );
</script>

<svelte:head>
  <title>Dashboard | Cockpit</title>
</svelte:head>

<div class="min-h-screen p-6 md:p-10">
  <div class="max-w-5xl mx-auto space-y-10">

    <!-- Header -->
    <header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between" in:fly={{ y: -10, duration: 300 }}>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p class="text-muted-foreground mt-1">
          Manage Claude Code instances across your devices
        </p>
      </div>
      <Button onclick={() => (showNewInstanceModal = true)}>
        <Plus class="size-4" />
        New Instance
      </Button>
    </header>

    <NewInstanceModal bind:open={showNewInstanceModal} onClose={() => (showNewInstanceModal = false)} />

    <!-- Stats -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-6" in:fly={{ y: -10, duration: 300, delay: 50 }}>
      <div class="space-y-1">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Terminal class="size-4" />
          <span class="text-sm">Instances</span>
        </div>
        <p class="text-3xl font-semibold tabular-nums">{$stats.runningInstances}</p>
        <p class="text-sm text-muted-foreground">{$stats.totalInstances} total</p>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Server class="size-4" />
          <span class="text-sm">Agents</span>
        </div>
        <p class="text-3xl font-semibold tabular-nums">{$stats.onlineAgents}</p>
        <p class="text-sm text-muted-foreground">{$stats.totalAgents} total</p>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-2 text-muted-foreground">
          <Activity class="size-4" />
          <span class="text-sm">Active Tasks</span>
        </div>
        <p class="text-3xl font-semibold tabular-nums">{$stats.activeTasks}</p>
        <p class="text-sm text-muted-foreground">in progress</p>
      </div>

      <div class="space-y-1">
        <div class="flex items-center gap-2 text-muted-foreground">
          <DollarSign class="size-4" />
          <span class="text-sm">Total Cost</span>
        </div>
        <p class="text-3xl font-semibold tabular-nums">{formattedCost}</p>
        <p class="text-sm text-muted-foreground">all time</p>
      </div>
    </section>

    <!-- Main Content -->
    <div class="grid lg:grid-cols-5 gap-10">
      <!-- Recent Instances -->
      <section class="lg:col-span-3 space-y-4" in:fly={{ y: 10, duration: 300, delay: 100 }}>
        <div class="flex items-center justify-between">
          <h2 class="font-medium">Recent Instances</h2>
          <a href="/instances" class="group text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors">
            View all
            <ChevronRight class="size-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>

        {#if $recentInstances.length > 0}
          <div class="space-y-3">
            {#each $recentInstances as instance (instance.id)}
              <InstanceCard {instance} />
            {/each}
          </div>
        {:else}
          <div class="py-16">
            <EmptyState
              icon={Terminal}
              title="No instances yet"
              description="Create your first instance to get started"
              size="sm"
              action={{
                label: "New Instance",
                onClick: () => (showNewInstanceModal = true),
              }}
            />
          </div>
        {/if}
      </section>

      <!-- Connected Agents -->
      <section class="lg:col-span-2 space-y-4" in:fly={{ y: 10, duration: 300, delay: 150 }}>
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h2 class="font-medium">Agents</h2>
            {#if $onlineAgents.length > 0}
              <span class="size-2 rounded-full bg-success animate-pulse"></span>
            {/if}
          </div>
          <a href="/agents" class="group text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors">
            View all
            <ChevronRight class="size-4 group-hover:translate-x-0.5 transition-transform" />
          </a>
        </div>

        {#if $onlineAgents.length > 0}
          <div class="space-y-3">
            {#each $onlineAgents as agent (agent.machineId)}
              <AgentCard {agent} />
            {/each}
          </div>
        {:else}
          <div class="py-16">
            <EmptyState
              icon={Server}
              title="No agents online"
              description="Run 'cockpit agent' on a device"
              size="sm"
            />
          </div>
        {/if}
      </section>
    </div>

    <!-- Getting Started -->
    {#if $stats.totalInstances === 0 && $stats.totalAgents === 0}
      <section class="rounded-2xl bg-secondary/50 p-8" in:fade={{ duration: 200 }}>
        <div class="flex items-start gap-6">
          <div class="size-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            <Zap class="size-6 text-primary" />
          </div>
          <div class="flex-1">
            <h3 class="text-lg font-medium mb-2">Get Started with Cockpit</h3>
            <p class="text-muted-foreground text-sm mb-6">
              Cockpit lets you manage Claude Code instances across multiple machines.
            </p>
            <ol class="space-y-4 text-sm">
              <li class="flex gap-4">
                <span class="text-primary font-mono">1.</span>
                <div>
                  <p class="font-medium mb-1">Start an agent on your machine</p>
                  <code class="text-xs font-mono text-muted-foreground">cockpit agent</code>
                </div>
              </li>
              <li class="flex gap-4">
                <span class="text-primary font-mono">2.</span>
                <div>
                  <p class="font-medium mb-1">Create a new instance</p>
                  <p class="text-muted-foreground">Click "New Instance" to spawn a Claude Code session</p>
                </div>
              </li>
              <li class="flex gap-4">
                <span class="text-primary font-mono">3.</span>
                <div>
                  <p class="font-medium mb-1">Chat with Claude</p>
                  <p class="text-muted-foreground">Send messages and watch Claude work on your code</p>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>
    {/if}

    <!-- Connection Status -->
    {#if $connectionStatus !== "connected"}
      <div class="fixed bottom-6 right-6 z-50" in:fly={{ y: 10, duration: 200 }}>
        <div class="rounded-xl bg-card border border-border px-4 py-3 shadow-lg flex items-center gap-3">
          {#if $connectionStatus === "connecting"}
            <span class="size-2 rounded-full bg-warning animate-pulse"></span>
            <span class="text-sm text-muted-foreground">Connecting...</span>
          {:else if $connectionStatus === "error"}
            <span class="size-2 rounded-full bg-error"></span>
            <span class="text-sm text-error">Connection error</span>
          {:else}
            <span class="size-2 rounded-full bg-muted-foreground"></span>
            <span class="text-sm text-muted-foreground">Disconnected</span>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>
