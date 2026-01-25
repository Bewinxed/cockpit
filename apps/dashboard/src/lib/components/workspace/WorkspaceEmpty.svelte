<script lang="ts">
  import { Plus, Terminal, Sparkles } from 'lucide-svelte';
  import { Button } from '$lib/components/ui/button';
  import { stores, agents } from '$lib/stores';

  interface Props {
    onNewInstance?: () => void;
  }

  let { onNewInstance }: Props = $props();

  const hasAgents = $derived(agents.online.length > 0);
</script>

<div class="flex-1 flex items-center justify-center p-8">
  <div class="max-w-md text-center space-y-6">
    <!-- Icon -->
    <div class="mx-auto w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
      <Terminal class="w-8 h-8 text-muted-foreground" />
    </div>

    <!-- Title -->
    <div class="space-y-2">
      <h2 class="text-2xl font-semibold text-foreground">
        Welcome to Cockpit
      </h2>
      <p class="text-muted-foreground">
        {#if hasAgents}
          Select an instance from the sidebar or create a new one to get started.
        {:else}
          Connect an agent to start running Claude instances.
        {/if}
      </p>
    </div>

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
      Pro tip: Press <kbd class="px-1.5 py-0.5 bg-muted rounded text-[10px] font-mono">⌘K</kbd> to quickly search and navigate
    </p>
  </div>
</div>
