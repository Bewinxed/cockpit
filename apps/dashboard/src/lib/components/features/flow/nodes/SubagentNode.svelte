<script lang="ts">
  import { Handle, Position, useStore, useSvelteFlow } from '@xyflow/svelte';
  import { Zap, LoaderCircle, CircleCheck, CircleX, ChevronRight, ChevronDown, Layers, Wrench } from 'lucide-svelte';
  import { slide } from 'svelte/transition';
  import type { SubagentState, Message } from '$lib/stores/types';
  import { instances } from '$lib/stores';
  import { getToolGlance, getToolStatus } from '$lib/utils/tool-display';
  import {
    ELAPSED_TIME_UPDATE_INTERVAL,
    SLIDE_DURATION,
    ZOOM_THRESHOLD_OVERVIEW,
    ZOOM_THRESHOLD_SUMMARY,
    SUBAGENT_RESULT_MAX_CHARS,
    BRANCH_COLORS_FALLBACK,
  } from '$lib/utils/flow-constants';

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

  // Expansion state - track which subagents are expanded by toolUseId
  let expandedSet = $state(new Set<string>());

  // Semantic zoom levels
  const zoomLevel = $derived(
    zoom < ZOOM_THRESHOLD_OVERVIEW ? 'overview' :
    zoom < ZOOM_THRESHOLD_SUMMARY ? 'summary' :
    'detail'
  );

  // Use subagents array if available, otherwise wrap single subagent
  const allSubagents = $derived.by(() => {
    if (data?.subagents && data.subagents.length > 0) {
      return data.subagents;
    }
    if (data?.subagent) {
      return [data.subagent];
    }
    return [];
  });

  const isParallel = $derived(allSubagents.length > 1);
  const depth = $derived(data?.depth || 0);
  const branchColor = $derived(data?.branchColor || BRANCH_COLORS_FALLBACK[1]);

  // Aggregate status for the whole group
  const groupStatus = $derived.by(() => {
    if (allSubagents.length === 0) return 'starting';
    const statuses = allSubagents.map(s => s.status);
    if (statuses.some(s => s === 'error')) return 'error';
    if (statuses.some(s => s === 'running')) return 'running';
    if (statuses.some(s => s === 'starting')) return 'starting';
    if (statuses.every(s => s === 'complete')) return 'complete';
    return 'running';
  });

  // Total tool count across all subagents
  const totalToolCount = $derived(
    allSubagents.reduce((sum, s) => sum + (s.messages?.length || 0), 0)
  );

  // Status styling helpers
  function getStatusIcon(status: string) {
    switch (status) {
      case 'complete': return CircleCheck;
      case 'error': return CircleX;
      default: return LoaderCircle;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'complete': return 'text-green-500';
      case 'error': return 'text-red-500';
      case 'running': return 'text-cyan-500';
      default: return 'text-muted-foreground';
    }
  }

  function getBorderClass(status: string): string {
    switch (status) {
      case 'complete': return 'border-green-500';
      case 'error': return 'border-red-500';
      case 'running': return 'border-cyan-500 animate-pulse';
      default: return 'border-cyan-500';
    }
  }

  // Get tool messages for a subagent
  function getToolMessages(subagent: SubagentState): Message[] {
    return subagent.messages?.filter((m: Message) => m.type === 'tool.use') || [];
  }

  // Get child subagents (nested)
  function getChildSubagents(subagent: SubagentState): SubagentState[] {
    return subagent.toolUseId ? instances.getChildSubagents(subagent.toolUseId) : [];
  }

  // Format elapsed time
  function formatElapsed(subagent: SubagentState): string {
    let ms = 0;
    if (subagent.status === 'running' || subagent.status === 'starting') {
      const startTime = subagent.startedAt ? new Date(subagent.startedAt).getTime() : Date.now();
      ms = Date.now() - startTime;
    } else if (subagent.completedAt && subagent.startedAt) {
      ms = new Date(subagent.completedAt).getTime() - new Date(subagent.startedAt).getTime();
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  // Current action for a subagent
  function getCurrentAction(subagent: SubagentState): string {
    if (subagent.status !== 'running') return '';
    const lastMsg = subagent.messages?.[subagent.messages.length - 1];
    if (lastMsg?.type === 'tool.use') {
      return lastMsg.metadata?.toolName || 'Working...';
    }
    return 'Working...';
  }

  // Toggle expansion for a specific subagent
  function toggleExpanded(toolUseId: string, e: MouseEvent) {
    e.stopPropagation();
    const newSet = new Set(expandedSet);
    if (newSet.has(toolUseId)) {
      newSet.delete(toolUseId);
    } else {
      newSet.add(toolUseId);
    }
    expandedSet = newSet;
  }

  // Click to zoom into branch (when in detail view)
  function handleClick() {
    if (zoomLevel !== 'detail') {
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

  // Force re-render every second for elapsed time
  // Uses a stable interval that's only created/destroyed based on running status
  let tick = $state(0);
  let intervalId = $state<ReturnType<typeof setInterval> | null>(null);

  $effect(() => {
    const hasRunning = allSubagents.some(s => s.status === 'running' || s.status === 'starting');

    if (hasRunning && !intervalId) {
      // Start interval if running and not already started
      intervalId = setInterval(() => {
        tick = tick + 1;
      }, ELAPSED_TIME_UPDATE_INTERVAL);
    } else if (!hasRunning && intervalId) {
      // Clear interval if no longer running
      clearInterval(intervalId);
      intervalId = null;
    }

    // Cleanup on unmount
    return () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
  });
</script>

<Handle type="target" position={Position.Top} style="background: {branchColor}" />

<!-- Use tick to force elapsed time updates -->
{#key tick}
<div
  class="subagent-node rounded-lg border-l-4 {getBorderClass(groupStatus)} bg-card p-3 w-[320px] cursor-pointer hover:bg-accent/50 transition-colors"
  style="border-left-color: {branchColor}"
  onclick={handleClick}
  role="button"
  tabindex="0"
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
>
  {#if zoomLevel === 'overview'}
    <!-- Overview: just icons -->
    <div class="flex items-center justify-center gap-2">
      {#if isParallel}
        <span class="text-xs font-medium text-muted-foreground">{allSubagents.length}×</span>
      {/if}
      <div class="rounded-full p-2" style="background: {branchColor}20">
        <Zap class="h-4 w-4" style="color: {branchColor}" />
      </div>
      <div class="w-2 h-2 rounded-full {getStatusColor(groupStatus) === 'text-green-500' ? 'bg-green-500' : getStatusColor(groupStatus) === 'text-red-500' ? 'bg-red-500' : 'bg-cyan-500'}"></div>
    </div>
  {:else if zoomLevel === 'summary'}
    <!-- Summary: one line per subagent -->
    <div class="space-y-1">
      {#if isParallel}
        <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          <Layers class="h-3 w-3" />
          <span>{allSubagents.length} parallel agents</span>
        </div>
      {/if}
      {#each allSubagents as subagent (subagent.toolUseId)}
        {@const SubIcon = getStatusIcon(subagent.status)}
        <div class="flex items-center gap-2">
          <Zap class="h-3 w-3 shrink-0" style="color: {branchColor}" />
          <span class="text-sm font-medium truncate">{subagent.subagentType}</span>
          {#if subagent.messages?.length}
            <span class="text-xs bg-muted px-1 py-0.5 rounded">{subagent.messages.length}</span>
          {/if}
          <SubIcon class="h-3 w-3 ml-auto {getStatusColor(subagent.status)} {subagent.status === 'running' ? 'animate-spin' : ''}" />
        </div>
      {/each}
    </div>
  {:else}
    <!-- Detail: full info for each subagent -->
    <div class="space-y-3">
      {#if isParallel}
        <div class="flex items-center gap-2 pb-2 border-b border-border">
          <Layers class="h-4 w-4 text-muted-foreground" />
          <span class="text-sm font-medium">{allSubagents.length} Parallel Agents</span>
          <span class="text-xs text-muted-foreground ml-auto">{totalToolCount} tools total</span>
        </div>
      {/if}

      {#each allSubagents as subagent, i (subagent.toolUseId)}
        {@const SubIcon = getStatusIcon(subagent.status)}
        {@const toolMessages = getToolMessages(subagent)}
        {@const childSubagents = getChildSubagents(subagent)}
        {@const isExpanded = expandedSet.has(subagent.toolUseId)}

        <div class="space-y-2 {i > 0 ? 'pt-2 border-t border-border/50' : ''}">
          <!-- Header -->
          <div class="flex items-center gap-2">
            <Zap class="h-4 w-4 shrink-0" style="color: {branchColor}" />
            <span class="text-sm font-medium">{subagent.subagentType}</span>
            <SubIcon class="h-4 w-4 ml-auto {getStatusColor(subagent.status)} {subagent.status === 'running' ? 'animate-spin' : ''}" />
          </div>

          <!-- Status line -->
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span class="capitalize">{subagent.status}</span>
            <span>|</span>
            <span>{formatElapsed(subagent)}</span>
            {#if subagent.messages?.length}
              <span>|</span>
              <span>{subagent.messages.length} tools</span>
            {/if}
          </div>

          <!-- Description -->
          {#if subagent.description}
            <div class="text-xs text-muted-foreground truncate">
              {subagent.description}
            </div>
          {/if}

          <!-- Current action -->
          {#if getCurrentAction(subagent)}
            <div class="text-xs text-cyan-500">
              → {getCurrentAction(subagent)}
            </div>
          {/if}

          <!-- Expand/collapse -->
          {#if toolMessages.length > 0 || childSubagents.length > 0}
            <button
              class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
              onclick={(e) => toggleExpanded(subagent.toolUseId, e)}
            >
              {#if isExpanded}
                <ChevronDown class="h-3 w-3" />
                <span>Hide details</span>
              {:else}
                <ChevronRight class="h-3 w-3" />
                <span>Show {toolMessages.length} tools{childSubagents.length > 0 ? `, ${childSubagents.length} nested` : ''}</span>
              {/if}
            </button>
          {/if}

          <!-- Expanded content -->
          {#if isExpanded}
            <div class="border-t border-border/50 pt-2 space-y-1" transition:slide={{ duration: SLIDE_DURATION }}>
              {#each toolMessages as tool (tool.metadata?.toolId)}
                <div class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/50">
                  <Wrench class="h-3 w-3 {getToolStatusColor(tool)} shrink-0" />
                  <span class="font-medium">{tool.metadata?.toolName || 'Tool'}</span>
                  <span class="text-muted-foreground truncate">
                    {getToolGlance(tool.metadata?.toolInput as Record<string, unknown>) || ''}
                  </span>
                </div>
              {/each}

              {#each childSubagents as child (child.toolUseId)}
                <div class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-cyan-500/10 border-l-2 border-cyan-500">
                  <Zap class="h-3 w-3 text-cyan-500 shrink-0" />
                  <span class="font-medium">{child.subagentType}</span>
                  <span class="text-muted-foreground capitalize">{child.status}</span>
                  {#if child.messages.length > 0}
                    <span class="text-xs bg-muted px-1 rounded">{child.messages.length}</span>
                  {/if}
                </div>
              {/each}

              {#if subagent.status === 'complete' && subagent.result}
                <div class="text-xs text-muted-foreground bg-muted/30 p-2 rounded max-h-20 overflow-y-auto">
                  <span class="font-medium">Result: </span>
                  {subagent.result.slice(0, SUBAGENT_RESULT_MAX_CHARS)}{subagent.result.length > SUBAGENT_RESULT_MAX_CHARS ? '...' : ''}
                </div>
              {/if}
            </div>
          {/if}
        </div>
      {/each}

      {#if depth >= 3}
        <div class="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t border-border">
          <Layers class="h-3 w-3" />
          <span>+{depth - 2} nested levels</span>
        </div>
      {/if}
    </div>
  {/if}
</div>
{/key}

<Handle type="source" position={Position.Bottom} style="background: {branchColor}" />
