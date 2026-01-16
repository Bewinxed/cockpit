<script lang="ts">
  import { Handle, Position, useStore, useSvelteFlow } from '@xyflow/svelte';
  import { Zap, LoaderCircle, CircleCheck, CircleX, ChevronRight, Layers } from 'lucide-svelte';
  import type { SubagentState } from '$lib/stores/types';

  // Props passed by SvelteFlow
  let { id, data } = $props<{
    id: string;
    data: {
      subagent?: SubagentState;
      depth?: number;
      branchColor?: string;
    };
  }>();

  // Get store for zoom level
  const { viewport } = $derived(useStore());
  const { fitView } = useSvelteFlow();
  const zoom = $derived(viewport.zoom);

  // Semantic zoom levels
  const zoomLevel = $derived(
    zoom < 0.5 ? 'overview' :
    zoom < 1.0 ? 'summary' :
    'detail'
  );

  const subagent = $derived(data?.subagent);
  const depth = $derived(data?.depth || 0);
  const branchColor = $derived(data?.branchColor || '#22c55e');

  // Status
  const status = $derived(subagent?.status || 'starting');
  const subagentType = $derived(subagent?.subagentType || 'Task');
  const toolCount = $derived(subagent?.messages?.length || 0);

  // Elapsed time
  let elapsedMs = $state(0);
  const elapsedText = $derived.by(() => {
    const seconds = Math.floor(elapsedMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  });

  // Timer for elapsed time
  $effect(() => {
    if (status === 'running' || status === 'starting') {
      const startTime = subagent?.startedAt ? new Date(subagent.startedAt).getTime() : Date.now();
      const interval = setInterval(() => {
        elapsedMs = Date.now() - startTime;
      }, 1000);
      return () => clearInterval(interval);
    } else if (subagent?.completedAt && subagent?.startedAt) {
      elapsedMs = new Date(subagent.completedAt).getTime() - new Date(subagent.startedAt).getTime();
    }
    return undefined;
  });

  // Status styling
  const StatusIcon = $derived.by(() => {
    switch (status) {
      case 'complete': return CircleCheck;
      case 'error': return CircleX;
      default: return LoaderCircle;
    }
  });

  const statusColor = $derived.by(() => {
    switch (status) {
      case 'complete': return 'text-green-500';
      case 'error': return 'text-red-500';
      case 'running': return 'text-cyan-500';
      default: return 'text-muted-foreground';
    }
  });

  const borderClass = $derived.by(() => {
    switch (status) {
      case 'complete': return 'border-green-500';
      case 'error': return 'border-red-500';
      case 'running': return 'border-cyan-500 animate-pulse';
      default: return 'border-cyan-500';
    }
  });

  // Current action (for summary level)
  const currentAction = $derived.by(() => {
    if (status !== 'running') return '';
    const lastMsg = subagent?.messages?.[subagent.messages.length - 1];
    if (lastMsg?.type === 'tool_use') {
      return lastMsg.metadata?.toolName || 'Working...';
    }
    return 'Working...';
  });

  // Click to zoom into branch
  function handleClick() {
    fitView({ nodes: [{ id }], duration: 300 });
  }
</script>

<Handle type="target" position={Position.Top} style="background: {branchColor}" />

<div
  class="subagent-node rounded-lg border-l-4 {borderClass} bg-card p-3 min-w-[200px] max-w-[400px] cursor-pointer hover:bg-accent/50 transition-colors"
  style="border-left-color: {branchColor}"
  onclick={handleClick}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
>
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center gap-2">
      <div class="rounded-full p-2" style="background: {branchColor}20">
        <Zap class="h-4 w-4" style="color: {branchColor}" />
      </div>
      <div class="w-2 h-2 rounded-full {statusColor === 'text-green-500' ? 'bg-green-500' : statusColor === 'text-red-500' ? 'bg-red-500' : 'bg-cyan-500'}"></div>
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <Zap class="h-4 w-4 shrink-0" style="color: {branchColor}" />
      <span class="text-sm font-medium">{subagentType}</span>
      {#if toolCount > 0}
        <span class="text-xs bg-muted px-1.5 py-0.5 rounded">{toolCount} tools</span>
      {/if}
      {#if currentAction}
        <span class="text-xs text-muted-foreground truncate ml-auto">{currentAction}</span>
      {/if}
      <StatusIcon class="h-4 w-4 {statusColor} {status === 'running' ? 'animate-spin' : ''}" />
    </div>
  {:else}
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <Zap class="h-4 w-4 shrink-0" style="color: {branchColor}" />
        <span class="text-sm font-medium">{subagentType}</span>
        <StatusIcon class="h-4 w-4 ml-auto {statusColor} {status === 'running' ? 'animate-spin' : ''}" />
      </div>

      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <span class="capitalize">{status}</span>
        <span>|</span>
        <span>{elapsedText}</span>
        {#if toolCount > 0}
          <span>|</span>
          <span>{toolCount} tools</span>
        {/if}
      </div>

      {#if subagent?.description}
        <div class="text-xs text-muted-foreground truncate">
          {subagent.description}
        </div>
      {/if}

      {#if depth < 3}
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          <ChevronRight class="h-3 w-3" />
          <span>Click to expand branch</span>
        </div>
      {:else}
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          <Layers class="h-3 w-3" />
          <span>+{depth - 2} nested levels</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} style="background: {branchColor}" />
