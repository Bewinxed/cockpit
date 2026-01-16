<script lang="ts">
  import { Handle, Position, useStore } from '@xyflow/svelte';
  import { Bot, Sparkles } from 'lucide-svelte';
  import Markdown from '@humanspeak/svelte-markdown';
  import type { Message } from '$lib/stores/types';

  // Props passed by SvelteFlow
  let { id, data } = $props<{
    id: string;
    data: {
      message?: Message;
      content?: string;
      model?: string;
    };
  }>();

  // Get store for zoom level
  const { viewport } = $derived(useStore());
  const zoom = $derived(viewport.zoom);

  // Semantic zoom levels
  const zoomLevel = $derived(
    zoom < 0.5 ? 'overview' :
    zoom < 1.0 ? 'summary' :
    'detail'
  );

  const displayContent = $derived((data?.content || data?.message?.content || '') as string);
  const firstLine = $derived(displayContent.split('\n')[0].slice(0, 80));
  const model = $derived(data?.model || data?.message?.metadata?.model || '');
  const timestamp = $derived(
    data?.message?.timestamp
      ? new Date(data.message.timestamp).toLocaleTimeString()
      : ''
  );
</script>

<Handle type="target" position={Position.Top} class="!bg-purple-500" />

<div class="assistant-message-node rounded-lg border-l-4 border-purple-500 bg-card p-3 min-w-[200px] max-w-[400px]">
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center">
      <div class="rounded-full bg-purple-500/20 p-2">
        <Sparkles class="h-4 w-4 text-purple-500" />
      </div>
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <Bot class="h-4 w-4 text-purple-500 shrink-0" />
      <span class="text-sm truncate text-foreground">{firstLine}{firstLine.length >= 80 ? '...' : ''}</span>
    </div>
  {:else}
    <div class="flex items-start gap-2">
      <Bot class="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs text-muted-foreground">Claude</span>
          {#if model}
            <span class="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">{model}</span>
          {/if}
        </div>
        <div class="text-sm prose prose-sm dark:prose-invert max-w-none">
          <Markdown source={displayContent} />
        </div>
        {#if timestamp}
          <div class="text-xs text-muted-foreground mt-1">{timestamp}</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} class="!bg-purple-500" />
