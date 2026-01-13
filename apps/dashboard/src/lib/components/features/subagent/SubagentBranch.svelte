<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { ChevronRight, Loader2, CheckCircle2, XCircle, Zap, Check, X, Clock, ChevronDown } from 'lucide-svelte';
  import Markdown from '@humanspeak/svelte-markdown';
  import type { SubagentState, Message } from '$lib/stores/realtime.svelte';
  import { getChildSubagents } from '$lib/stores/realtime.svelte';

  interface Props {
    subagent: SubagentState;
    depth?: number;
  }

  let { subagent, depth = 0 }: Props = $props();

  let expanded = $state(true);
  let elapsedMs = $state(0);
  let intervalId: ReturnType<typeof setInterval> | null = null;
  // Track which tools are expanded (collapsed by default)
  let expandedTools = $state<Set<string>>(new Set());

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

  // Filter tool_use messages from subagent messages (not tool_result - those update the tool_use)
  const toolMessages = $derived(
    subagent.messages.filter(m => m.type === 'tool_use')
  );

  // Get compact tool info for display
  function getToolStatus(tool: Message): 'pending' | 'success' | 'error' {
    return tool.metadata?.toolStatus || 'pending';
  }

  // Get a brief description/glance for a tool (same logic as ToolGroup)
  function getToolGlance(tool: Message): string {
    const input = tool.metadata?.toolInput as Record<string, unknown> | undefined;
    if (!input) return '';

    // File operations - show path
    if (input.file_path) return String(input.file_path).split('/').slice(-2).join('/');
    if (input.path) return String(input.path).split('/').slice(-2).join('/');

    // Bash - show command preview
    if (input.command) {
      const cmd = String(input.command);
      return cmd.length > 40 ? cmd.slice(0, 40) + '...' : cmd;
    }

    // Search - show pattern
    if (input.pattern) return `/${input.pattern}/`;

    // Glob
    if (input.glob) return String(input.glob);

    return '';
  }

  // Get tool result as string
  function getToolResult(tool: Message): string | null {
    const result = tool.metadata?.toolResult;
    if (result === undefined || result === null) return null;
    return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
  }

  // Get first line or first N chars as glimpse
  function getResultGlimpse(result: string | null): string {
    if (!result) return '';
    const firstLine = result.split('\n')[0];
    if (firstLine.length > 60) return firstLine.slice(0, 60) + '...';
    return firstLine;
  }

  // Toggle tool expansion
  function toggleTool(toolId: string) {
    if (expandedTools.has(toolId)) {
      expandedTools.delete(toolId);
    } else {
      expandedTools.add(toolId);
    }
    expandedTools = new Set(expandedTools); // trigger reactivity
  }

  function isToolExpanded(toolId: string): boolean {
    return expandedTools.has(toolId);
  }

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
      <!-- Compact tool list with collapsible results -->
      {#if toolMessages.length > 0}
        <div class="space-y-0.5">
          {#each toolMessages as tool, idx (tool.metadata?.toolId ?? tool.id ?? idx)}
            {@const toolId = (tool.metadata?.toolId ?? tool.id ?? `tool-${idx}`) as string}
            {@const status = getToolStatus(tool)}
            {@const glance = getToolGlance(tool)}
            {@const result = getToolResult(tool)}
            {@const resultGlimpse = getResultGlimpse(result)}
            {@const isExpanded = isToolExpanded(toolId)}
            <div class="border-b border-border/30 last:border-b-0">
              <!-- Tool header (clickable to expand) -->
              <button
                type="button"
                class="w-full px-2 py-1 flex items-center gap-1.5 text-xs hover:bg-muted/30 transition-colors"
                onclick={() => toggleTool(toolId)}
              >
                <!-- Expand icon -->
                <ChevronRight
                  class="size-3 text-muted-foreground transition-transform flex-shrink-0 {isExpanded ? 'rotate-90' : ''}"
                />
                <!-- Status icon -->
                {#if status === 'success'}
                  <Check class="size-3 text-success flex-shrink-0" />
                {:else if status === 'error'}
                  <X class="size-3 text-destructive flex-shrink-0" />
                {:else}
                  <Clock class="size-3 text-muted-foreground animate-pulse flex-shrink-0" />
                {/if}
                <!-- Tool name -->
                <span class="font-medium text-foreground">{tool.metadata?.toolName || tool.content}</span>
                <!-- Input preview (smaller, mono) -->
                {#if glance}
                  <span class="text-muted-foreground truncate font-mono text-[10px]">{glance}</span>
                {/if}
                <!-- Result glimpse when collapsed -->
                {#if !isExpanded && resultGlimpse}
                  <span class="text-muted-foreground/60 truncate flex-1 font-mono text-[9px]">
                    → {resultGlimpse}
                  </span>
                {/if}
              </button>
              <!-- Expanded result -->
              {#if isExpanded && result}
                <div class="px-2 py-1 bg-muted/10" transition:slide={{ duration: 150 }}>
                  <div class="prose prose-xs max-w-none text-[11px] overflow-auto max-h-48 custom-scrollbar [&_pre]:bg-muted/50 [&_pre]:p-1.5 [&_pre]:rounded [&_pre]:text-[10px] [&_code]:text-[10px] [&_p]:my-0.5 [&_br]:block">
                    <Markdown source={result} options={{ breaks: true }} />
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {:else if subagent.status === 'starting' || subagent.status === 'running'}
        <div class="px-3 py-2 text-xs text-muted-foreground italic">
          Working...
        </div>
      {/if}

      <!-- Result -->
      {#if subagent.status === 'complete' && subagent.result}
        <div class="px-3 pb-3">
          <div class="text-xs text-muted-foreground mb-1">Result:</div>
          <div class="bg-muted/50 rounded p-2 max-h-40 overflow-auto custom-scrollbar prose prose-xs max-w-none [&_pre]:bg-background/50 [&_pre]:p-2 [&_pre]:rounded [&_pre]:text-[10px] [&_code]:text-[10px] [&_p]:my-1 [&_p]:text-xs [&_br]:block">
            <Markdown source={subagent.result} options={{ breaks: true }} />
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
