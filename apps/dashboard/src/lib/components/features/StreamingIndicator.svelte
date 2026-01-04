<script lang="ts">
  import { getStreamingState, type StreamingState } from '$lib/stores/realtime';
  import { derived, type Readable } from 'svelte/store';

  export let instanceId: string;

  const streamingState: Readable<StreamingState | null> = getStreamingState(instanceId);

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
  <div class="streaming-indicator flex items-center gap-3 text-sm">
    {#if $streamingState.isStreaming}
      <div class="flex items-center gap-1.5 text-blue-400">
        <span class="relative flex h-2 w-2">
          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
          <span class="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
        </span>
        <span class="text-xs">Streaming...</span>
      </div>
    {/if}

    {#if $streamingState.sessionInputTokens > 0 || $streamingState.sessionOutputTokens > 0}
      <div class="flex items-center gap-2 text-xs text-gray-400">
        <span class="flex items-center gap-1" title="Input tokens">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16l-4-4m0 0l4-4m-4 4h18" />
          </svg>
          {formatTokens($streamingState.sessionInputTokens)}
        </span>
        <span class="flex items-center gap-1" title="Output tokens">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
          {formatTokens($streamingState.sessionOutputTokens)}
        </span>
      </div>
    {/if}

    {#if $streamingState.costUsd > 0}
      <div class="text-xs text-green-400" title="Session cost">
        {formatCost($streamingState.costUsd)}
      </div>
    {/if}
  </div>
{/if}

<style>
  .streaming-indicator {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;
  }
</style>
