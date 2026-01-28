<script lang="ts">
  import { Plus, Terminal, Sparkles, Clock, Folder, Circle } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { stores, agents, instances } from '$lib/stores';
  import { openInstance } from '$lib/stores/url-sync.svelte';

  interface Props {
    onNewInstance?: () => void;
  }

  let { onNewInstance }: Props = $props();

  const hasAgents = $derived(agents.online.length > 0);

  // Recent instances sorted by last activity (up to 6)
  const recentInstances = $derived(
    stores.populatedInstances
      .sort((a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime())
      .slice(0, 6)
  );

  function getStatusColor(status: string): string {
    switch (status) {
      case 'running': return 'text-success';
      case 'starting': return 'text-warning';
      case 'error': return 'text-destructive';
      case 'sleeping': return 'text-info';
      default: return 'text-muted-foreground/50';
    }
  }

  function formatTimeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function getInstanceName(instance: { name?: string; cwd?: string; id: string }): string {
    if (instance.name && instance.name !== 'Instance') return instance.name;
    if (instance.cwd) {
      const parts = instance.cwd.split('/');
      return parts[parts.length - 1] || 'Instance';
    }
    return instance.id.slice(0, 8);
  }
</script>

<div class="flex-1 flex items-center justify-center p-8">
  <div class="max-w-xl w-full text-center space-y-8">
    <!-- Header -->
    <div class="space-y-2">
      <div class="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
        <Terminal class="w-6 h-6 text-primary" />
      </div>
      <h2 class="text-xl font-semibold text-foreground">
        Welcome to Cockpit
      </h2>
      <p class="text-sm text-muted-foreground">
        {#if hasAgents}
          Pick up where you left off or start something new.
        {:else}
          Connect an agent to start running Claude instances.
        {/if}
      </p>
    </div>

    <!-- Recent Instances Grid -->
    {#if recentInstances.length > 0}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
        {#each recentInstances as instance (instance.id)}
          <button
            class="group flex flex-col gap-2 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 hover:border-accent transition-colors text-left"
            onclick={() => openInstance(instance.id, true)}
          >
            <div class="flex items-center gap-2 min-w-0">
              <Circle class="size-2 shrink-0 fill-current {getStatusColor(instance.status)}" />
              <span class="text-sm font-medium text-foreground truncate">
                {getInstanceName(instance)}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs text-muted-foreground">
              {#if instance.project}
                <span class="flex items-center gap-1 truncate">
                  <Folder class="size-3 shrink-0" />
                  {instance.project}
                </span>
              {/if}
              <span class="flex items-center gap-1 shrink-0">
                <Clock class="size-3" />
                {formatTimeAgo(instance.lastActivity)}
              </span>
            </div>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Quick Stats -->
    {#if stores.stats.totalInstances > 0 || stores.stats.onlineAgents > 0}
      <div class="flex items-center justify-center gap-6 text-sm text-muted-foreground">
        <span>
          <span class="font-medium text-foreground">{stores.stats.runningInstances}</span> running
        </span>
        <span class="text-border">·</span>
        <span>
          <span class="font-medium text-foreground">{stores.stats.onlineAgents}</span> agents online
        </span>
        <span class="text-border">·</span>
        <span>
          <span class="font-medium text-foreground">${stores.stats.totalCostUsd.toFixed(2)}</span> spent
        </span>
      </div>
    {/if}

    <!-- Actions -->
    <div class="flex items-center justify-center gap-3">
      {#if hasAgents}
        <Button onclick={() => onNewInstance?.()} class="gap-2">
          <Plus class="w-4 h-4" />
          New Instance
        </Button>
      {:else}
        <div class="p-4 rounded-lg bg-muted/50 border border-border text-left space-y-2">
          <p class="text-sm font-medium text-foreground">Get Started</p>
          <p class="text-xs text-muted-foreground">
            Run the following command on your machine:
          </p>
          <code class="block p-2 bg-background rounded text-xs font-mono">
            bun install -g @agentdeck/cli && agentdeck agent
          </code>
        </div>
      {/if}
    </div>

    <!-- Tip -->
    <p class="text-xs text-muted-foreground flex items-center justify-center gap-1.5">
      <Sparkles class="w-3.5 h-3.5" />
      Press <kbd class="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">⌘K</kbd> to search and navigate
    </p>
  </div>
</div>
