<script lang="ts">
  import { Handle, Position, useStore } from '@xyflow/svelte';
  import { Bot, Sparkles, LoaderCircle } from 'lucide-svelte';
  import Markdown from '@humanspeak/svelte-markdown';
  import type { Message } from '$lib/stores/types';
  import { instances } from '$lib/stores';

  // Props passed by SvelteFlow
  let { id, data } = $props<{
    id: string;
    data: {
      message?: Message;
      content?: string;
      model?: string;
      instanceId?: string;
      isStreaming?: boolean;
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

  // Get streaming content if this message is currently streaming
  const streamingMessage = $derived(
    data?.instanceId ? instances.getStreamingMessage(data.instanceId) : null
  );

  // Check if this specific message is streaming
  const isStreaming = $derived(
    data?.isStreaming ||
    (streamingMessage?.sdkUuid && data?.message?.sdkUuid === streamingMessage.sdkUuid)
  );

  // Get streaming text from content blocks
  const streamingText = $derived.by(() => {
    if (!streamingMessage) return '';
    return Array.from(streamingMessage.contentBlocks.values()).join('');
  });

  // Display content: use streaming text if available, otherwise message content
  const displayContent = $derived(
    isStreaming && streamingText
      ? streamingText
      : (data?.content || data?.message?.content || '') as string
  );

  const firstLine = $derived(displayContent.split('\n')[0].slice(0, 80));
  const model = $derived(data?.model || data?.message?.metadata?.model || '');
  const timestamp = $derived(
    data?.message?.timestamp
      ? new Date(data.message.timestamp).toLocaleTimeString()
      : ''
  );
</script>

<Handle type="target" position={Position.Top} class="!bg-purple-500" />

<div class="assistant-message-node rounded-lg border-l-4 {isStreaming ? 'border-purple-500 animate-pulse' : 'border-purple-500'} bg-card p-3 min-w-[200px] max-w-[400px]">
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center gap-2">
      <div class="rounded-full bg-purple-500/20 p-2">
        <Sparkles class="h-4 w-4 text-purple-500" />
      </div>
      {#if isStreaming}
        <LoaderCircle class="h-3 w-3 text-purple-500 animate-spin" />
      {/if}
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <Bot class="h-4 w-4 text-purple-500 shrink-0" />
      <span class="text-sm truncate text-foreground">{firstLine}{firstLine.length >= 80 ? '...' : ''}</span>
      {#if isStreaming}
        <LoaderCircle class="h-3 w-3 text-purple-500 animate-spin ml-auto shrink-0" />
      {/if}
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
          {#if isStreaming}
            <span class="inline-block w-0.5 h-4 bg-purple-500 ml-0.5 animate-pulse"></span>
          {/if}
        </div>
        {#if timestamp && !isStreaming}
          <div class="text-xs text-muted-foreground mt-1">{timestamp}</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} class="!bg-purple-500" />
