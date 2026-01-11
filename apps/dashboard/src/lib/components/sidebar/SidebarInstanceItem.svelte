<script lang="ts">
  import type { Instance } from '$lib/stores/realtime.svelte';
  import { getStreamingState } from '$lib/stores/realtime.svelte';

  interface Props {
    instance: Instance;
    selected: boolean;
    collapsed?: boolean;
    onSelect: () => void;
  }

  let { instance, selected, collapsed = false, onSelect }: Props = $props();

  const streamingState = $derived(getStreamingState(instance.id));

  const statusColor = $derived(() => {
    switch (instance.status) {
      case 'running': return 'bg-success';
      case 'starting': return 'bg-warning animate-pulse';
      case 'error': return 'bg-error';
      case 'sleeping': return 'bg-info';
      default: return 'bg-muted-foreground/30';
    }
  });

  // Extract short name from cwd or lastPrompt
  const displayName = $derived(() => {
    if (instance.name && instance.name !== 'Instance') {
      return instance.name.slice(0, 30);
    }
    // Fallback to last path segment of cwd
    const parts = instance.cwd.split('/');
    return parts[parts.length - 1] || 'Instance';
  });
</script>

<button
  class="w-full flex items-center gap-2 px-2 py-1.5 text-sm rounded-md transition-all duration-150
    {selected ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-accent/50'}"
  onclick={onSelect}
  title={collapsed ? displayName() : undefined}
>
  <!-- Status Dot -->
  <div class="relative flex-shrink-0">
    <div class="w-2 h-2 rounded-full {statusColor()}"></div>
    {#if $streamingState?.isStreaming}
      <div class="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-info rounded-full animate-ping"></div>
    {/if}
  </div>

  {#if !collapsed}
    <!-- Instance Name -->
    <span class="flex-1 truncate text-left">
      {displayName()}
    </span>

    <!-- Cost (if running) -->
    {#if instance.status === 'running' && instance.totalCostUsd}
      <span class="text-xs opacity-60 font-mono">
        ${instance.totalCostUsd.toFixed(2)}
      </span>
    {/if}
  {/if}
</button>
