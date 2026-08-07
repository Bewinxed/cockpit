<script lang="ts">
  import { IconUser } from '$lib/icons';
  import { Handle, Position, useStore } from '@xyflow/svelte';
  import type { Message } from '$lib/cockpit/types';

  // Props passed by SvelteFlow
  let { data } = $props<{
    id: string;
    data: {
      message?: Message;
      content?: string;
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

  // User messages show full content at all levels per spec
  const displayContent = $derived((data?.content || data?.message?.content || '') as string);
  const timestamp = $derived(
    data?.message?.timestamp
      ? new Date(data.message.timestamp).toLocaleTimeString()
      : ''
  );
</script>

<Handle type="target" position={Position.Top} class="!bg-info" />

<div class="user-message-node rounded-xl shadow-sm bg-primary/[0.08] p-3 w-[320px]">
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center">
      <div class="rounded-full bg-info/20 p-2">
        <IconUser class="h-4 w-4 text-info" />
      </div>
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <IconUser class="h-4 w-4 text-info shrink-0" />
      <span class="text-sm truncate text-foreground">{displayContent.split('\n')[0]}</span>
    </div>
  {:else}
    <div class="flex items-start gap-2">
      <IconUser class="h-4 w-4 text-info shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="text-xs text-muted-foreground mb-1">You</div>
        <div class="text-sm text-foreground whitespace-pre-wrap break-words">{displayContent}</div>
        {#if timestamp}
          <div class="text-xs text-muted-foreground mt-1">{timestamp}</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} class="!bg-info" />
