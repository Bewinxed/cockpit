<script lang="ts">
  import { Handle, Position, useStore } from '@xyflow/svelte';
  import { Info, AlertTriangle, CheckCircle, Settings, Database, TerminalSquare } from 'lucide-svelte';
  import type { Message } from '$lib/stores/types';

  // Props passed by SvelteFlow
  let { id, data } = $props<{
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

  const subtype = $derived(data?.message?.metadata?.subtype || 'status');
  const displayContent = $derived((data?.content || data?.message?.content || '') as string);

  // Icon based on subtype
  const IconComponent = $derived.by(() => {
    switch (subtype) {
      case 'init': return Settings;
      case 'compact_boundary': return Database;
      case 'terminal_setup_info': return TerminalSquare;
      case 'status': return Info;
      case 'error': return AlertTriangle;
      default: return Info;
    }
  });

  // Color based on subtype
  const iconColor = $derived.by(() => {
    switch (subtype) {
      case 'error': return 'text-red-500';
      case 'init': return 'text-green-500';
      default: return 'text-muted-foreground';
    }
  });
</script>

<Handle type="target" position={Position.Top} class="!bg-gray-400" />

<div class="system-message-node rounded-lg border border-border bg-muted/50 p-2 w-[320px]">
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center">
      <IconComponent class="h-4 w-4 {iconColor}" />
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <IconComponent class="h-4 w-4 {iconColor} shrink-0" />
      <span class="text-xs text-muted-foreground capitalize truncate">{subtype.replace('_', ' ')}</span>
    </div>
  {:else}
    <div class="flex items-start gap-2">
      <IconComponent class="h-4 w-4 {iconColor} shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="text-xs text-muted-foreground capitalize mb-1">{subtype.replace('_', ' ')}</div>
        <div class="text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {displayContent}
        </div>
      </div>
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} class="!bg-gray-400" />
