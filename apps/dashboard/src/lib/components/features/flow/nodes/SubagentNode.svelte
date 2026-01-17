<script lang="ts">
  import { Handle, Position, useStore, useSvelteFlow } from '@xyflow/svelte';
  import { Zap, LoaderCircle, CircleCheck, CircleX, ChevronRight, ChevronDown, Layers, Wrench } from 'lucide-svelte';
  import { slide } from 'svelte/transition';
  import type { SubagentState, Message } from '$lib/stores/types';
  import { instances } from '$lib/stores';
  import { getToolGlance, getToolStatus } from '$lib/utils/tool-display';

  // Props passed by SvelteFlow
  let { id, data } = $props<{
    id: string;
    data: {
      subagent?: SubagentState;
      subagents?: SubagentState[];
      depth?: number;
      branchColor?: string;
      instanceId?: string;
    };
  }>();

  // Get store for zoom level
  const { viewport } = $derived(useStore());
  const { fitView } = useSvelteFlow();
  const zoom = $derived(viewport.zoom);

  // Expansion state
  let expanded = $state(false);

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

  // Get tool messages for expanded view
  const toolMessages = $derived(
    subagent?.messages?.filter((m: Message) => m.type === 'tool_use') || []
  );

  // Get child subagents (nested)
  const childSubagents = $derived(
    subagent?.toolUseId ? instances.getChildSubagents(subagent.toolUseId) : []
  );

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

  // Toggle expansion
  function toggleExpanded(e: MouseEvent) {
    e.stopPropagation();
    expanded = !expanded;
  }

  // Click to zoom into branch (when in detail view)
  function handleClick() {
    if (zoomLevel === 'detail') {
      // In detail view, click toggles expansion
      expanded = !expanded;
    } else {
      // In overview/summary, click zooms to node
      fitView({ nodes: [{ id }], duration: 300 });
    }
  }

  // Get tool icon color based on status
  function getToolStatusColor(msg: Message): string {
    const status = getToolStatus(msg.metadata);
    switch (status) {
      case 'success': return 'text-green-500';
      case 'error': return 'text-red-500';
      default: return 'text-amber-500';
    }
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

      <!-- Expand/collapse button -->
      <button
        class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        onclick={toggleExpanded}
      >
        {#if expanded}
          <ChevronDown class="h-3 w-3" />
          <span>Hide details</span>
        {:else}
          <ChevronRight class="h-3 w-3" />
          <span>Show {toolMessages.length} tools{childSubagents.length > 0 ? `, ${childSubagents.length} subagents` : ''}</span>
        {/if}
      </button>

      <!-- Expanded content -->
      {#if expanded}
        <div class="border-t border-border pt-2 mt-2 space-y-1" transition:slide={{ duration: 150 }}>
          <!-- Tool list -->
          {#each toolMessages as tool (tool.metadata?.toolId)}
            <div class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/50">
              <Wrench class="h-3 w-3 {getToolStatusColor(tool)} shrink-0" />
              <span class="font-medium">{tool.metadata?.toolName || 'Tool'}</span>
              <span class="text-muted-foreground truncate">
                {getToolGlance(tool.metadata?.toolInput as Record<string, unknown>) || ''}
              </span>
            </div>
          {/each}

          <!-- Child subagents -->
          {#each childSubagents as child (child.toolUseId)}
            <div class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-cyan-500/10 border-l-2 border-cyan-500">
              <Zap class="h-3 w-3 text-cyan-500 shrink-0" />
              <span class="font-medium">{child.subagentType}</span>
              <span class="text-muted-foreground capitalize">{child.status}</span>
              {#if child.messages.length > 0}
                <span class="text-xs bg-muted px-1 rounded">{child.messages.length} tools</span>
              {/if}
            </div>
          {/each}

          <!-- Result preview if complete -->
          {#if status === 'complete' && subagent?.result}
            <div class="text-xs text-muted-foreground bg-muted/30 p-2 rounded max-h-20 overflow-y-auto">
              <span class="font-medium">Result: </span>
              {subagent.result.slice(0, 200)}{subagent.result.length > 200 ? '...' : ''}
            </div>
          {/if}
        </div>
      {/if}

      {#if depth >= 3 && !expanded}
        <div class="flex items-center gap-1 text-xs text-muted-foreground">
          <Layers class="h-3 w-3" />
          <span>+{depth - 2} nested levels</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<Handle type="source" position={Position.Bottom} style="background: {branchColor}" />
