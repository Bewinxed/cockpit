<script lang="ts">
  import { IconAgent, IconSparkles, IconSpinner } from '$lib/icons';
  import { Handle, Position, useStore } from '@xyflow/svelte';
  import { Markdown } from '$lib/components/ui/markdown';
  import type { Message } from '$lib/cockpit/types';

  // Props passed by SvelteFlow
  let { data } = $props<{
    id: string;
    data: {
      message?: Message;
      content?: string;
      model?: string;
      instanceId?: string;
      isStreaming?: boolean;
      /** Partial text for the turn still being streamed. */
      streamingText?: string;
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

  const isStreaming = $derived(Boolean(data?.isStreaming));
  const streamingText = $derived(data?.streamingText ?? '');

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

<Handle type="target" position={Position.Top} class="!bg-primary" />

<div class="assistant-message-node rounded-lg border-l-4 {isStreaming ? 'border-primary animate-pulse' : 'border-primary'} bg-card p-3 w-[320px]">
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center gap-2">
      <div class="rounded-full bg-primary/20 p-2">
        <IconSparkles class="h-4 w-4 text-primary" />
      </div>
      {#if isStreaming}
        <IconSpinner class="h-3 w-3 text-primary animate-spin" />
      {/if}
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <IconAgent class="h-4 w-4 text-primary shrink-0" />
      <span class="text-sm truncate text-foreground">{firstLine}{firstLine.length >= 80 ? '...' : ''}</span>
      {#if isStreaming}
        <IconSpinner class="h-3 w-3 text-primary animate-spin ml-auto shrink-0" />
      {/if}
    </div>
  {:else}
    <div class="flex items-start gap-2">
      <IconAgent class="h-4 w-4 text-primary shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 mb-1">
          <span class="text-xs text-muted-foreground">Claude</span>
          {#if model}
            <span class="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">{model}</span>
          {/if}
        </div>
        <div class="text-sm">
          <Markdown source={displayContent} />
          {#if isStreaming}
            <span class="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse"></span>
          {/if}
        </div>
        {#if timestamp && !isStreaming}
          <div class="text-xs text-muted-foreground mt-1">{timestamp}</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} class="!bg-primary" />
