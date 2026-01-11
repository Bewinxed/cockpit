<script lang="ts">
  import { getStreamingState, type StreamingState } from '$lib/stores/realtime.svelte';
  import { derived, type Readable } from 'svelte/store';
  import { ArrowLeft, ArrowRight, DollarSign } from 'lucide-svelte';

  let { instanceId }: { instanceId: string } = $props();

  const streamingState: Readable<StreamingState | null> = $derived(getStreamingState(instanceId));

  // Format token count
  function formatTokens(count: number): string {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
    return count.toString();
  }

  // Format cost
  function formatCost(cost: number): string {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    return `$${cost.toFixed(2)}`;
  }
</script>

{#if $streamingState}
  <div class="flex items-center gap-3 text-xs font-mono">
    {#if $streamingState.isStreaming}
      <div class="flex items-center gap-1.5 text-secondary">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
        </span>
        <span>Streaming...</span>
      </div>
    {/if}

    {#if $streamingState.sessionInputTokens > 0 || $streamingState.sessionOutputTokens > 0}
      <div class="flex items-center gap-3 text-muted-foreground">
        <span class="flex items-center gap-1" title="Input tokens">
          <ArrowLeft class="w-3 h-3" />
          {formatTokens($streamingState.sessionInputTokens)}
        </span>
        <span class="flex items-center gap-1" title="Output tokens">
          <ArrowRight class="w-3 h-3" />
          {formatTokens($streamingState.sessionOutputTokens)}
        </span>
      </div>
    {/if}

    {#if $streamingState.costUsd > 0}
      <div class="flex items-center gap-0.5 text-success font-medium" title="Session cost">
        <DollarSign class="w-3 h-3" />
        <span>{$streamingState.costUsd.toFixed(4)}</span>
      </div>
    {/if}
  </div>
{/if}
