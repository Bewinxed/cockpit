<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ChevronRight, Loader2, CheckCircle2, XCircle, Zap } from 'lucide-svelte';
  import type { SubagentState } from '$lib/stores/realtime.svelte';
  import { getChildSubagents } from '$lib/stores/realtime.svelte';
  import { ToolGroup } from '$lib/components/features';

  interface Props {
    subagent: SubagentState;
    depth?: number;
  }

  let { subagent, depth = 0 }: Props = $props();

  let expanded = $state(true);
  let elapsedMs = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;

  // Get child subagents (nested)
  const childSubagents = $derived(getChildSubagents(subagent.toolUseId));

  // Calculate elapsed time
  const elapsedText = $derived.by(() => {
    const seconds = Math.floor(elapsedMs / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  });

  // Status color and icon
  const statusColor = $derived.by(() => {
    switch (subagent.status) {
      case 'starting': return 'text-warning';
      case 'running': return 'text-info';
      case 'complete': return 'text-success';
      case 'error': return 'text-destructive';
      default: return 'text-muted-foreground';
    }
  });

  // Status badge classes
  const statusBadgeClass = $derived.by(() => {
    switch (subagent.status) {
      case 'starting': return 'bg-warning/20 text-warning';
      case 'running': return 'bg-info/20 text-info';
      case 'complete': return 'bg-success/20 text-success';
      case 'error': return 'bg-destructive/20 text-destructive';
      default: return 'bg-muted text-muted-foreground';
    }
  });

  // Filter tool messages from subagent messages
  const toolMessages = $derived(
    subagent.messages.filter(m => m.type === 'tool_use' || m.type === 'tool_result')
  );

  onMount(() => {
    // Update elapsed time every second
    intervalId = setInterval(() => {
      if (subagent.status === 'starting' || subagent.status === 'running') {
        elapsedMs = Date.now() - subagent.startedAt.getTime();
      } else if (subagent.completedAt) {
        elapsedMs = subagent.completedAt.getTime() - subagent.startedAt.getTime();
      }
    }, 1000);

    // Initial calculation
    if (subagent.completedAt) {
      elapsedMs = subagent.completedAt.getTime() - subagent.startedAt.getTime();
    } else {
      elapsedMs = Date.now() - subagent.startedAt.getTime();
    }
  });

  onDestroy(() => {
    if (intervalId) clearInterval(intervalId);
  });
</script>

<div
  class="rounded-lg border border-border bg-card/50 overflow-hidden"
  class:ml-4={depth > 0}
  class:border-l-2={depth > 0}
  class:border-l-info={depth > 0}
>
  <!-- Header -->
  <button
    type="button"
    class="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/50 transition-colors"
    onclick={() => expanded = !expanded}
  >
    <!-- Expand/collapse icon -->
    <ChevronRight
      class="size-4 text-muted-foreground transition-transform {expanded ? 'rotate-90' : ''}"
    />

    <!-- Status indicator -->
    <div class="relative">
      {#if subagent.status === 'starting' || subagent.status === 'running'}
        <Loader2 class="size-4 animate-spin {statusColor}" />
        <div class="absolute -top-0.5 -right-0.5 size-1.5 bg-info rounded-full animate-ping"></div>
      {:else if subagent.status === 'complete'}
        <CheckCircle2 class="size-4 {statusColor}" />
      {:else if subagent.status === 'error'}
        <XCircle class="size-4 {statusColor}" />
      {:else}
        <Zap class="size-4 {statusColor}" />
      {/if}
    </div>

    <!-- Agent type -->
    <span class="font-medium text-sm">{subagent.subagentType}</span>

    <!-- Description (truncated) -->
    {#if subagent.description}
      <span class="text-xs text-muted-foreground truncate max-w-[200px]">
        {subagent.description}
      </span>
    {/if}

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- Status badge -->
    <span class="text-xs px-1.5 py-0.5 rounded-full capitalize {statusBadgeClass}">
      {subagent.status}
    </span>

    <!-- Elapsed time -->
    <span class="text-xs font-mono text-muted-foreground">
      {elapsedText}
    </span>

    <!-- Tool count -->
    {#if toolMessages.length > 0}
      <span class="text-xs text-muted-foreground">
        {toolMessages.length} tool{toolMessages.length !== 1 ? 's' : ''}
      </span>
    {/if}
  </button>

  <!-- Expanded content -->
  {#if expanded}
    <div class="border-t border-border" transition:slide={{ duration: 200 }}>
      <!-- Tool messages -->
      {#if toolMessages.length > 0}
        <div class="p-3">
          <ToolGroup tools={toolMessages} />
        </div>
      {:else if subagent.status === 'starting' || subagent.status === 'running'}
        <div class="p-3 text-sm text-muted-foreground italic">
          Working...
        </div>
      {/if}

      <!-- Result -->
      {#if subagent.status === 'complete' && subagent.result}
        <div class="px-3 pb-3">
          <div class="text-xs text-muted-foreground mb-1">Result:</div>
          <div class="text-sm bg-muted/50 rounded p-2 max-h-32 overflow-auto font-mono text-xs">
            {subagent.result.slice(0, 500)}{subagent.result.length > 500 ? '...' : ''}
          </div>
        </div>
      {/if}

      <!-- Error -->
      {#if subagent.status === 'error' && subagent.error}
        <div class="px-3 pb-3">
          <div class="text-xs text-destructive mb-1">Error:</div>
          <div class="text-sm bg-destructive/10 rounded p-2 text-destructive font-mono text-xs">
            {subagent.error}
          </div>
        </div>
      {/if}

      <!-- Nested subagents -->
      {#if $childSubagents.length > 0}
        <div class="px-3 pb-3 space-y-2">
          {#each $childSubagents as child (child.toolUseId)}
            <svelte:self subagent={child} depth={depth + 1} />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
