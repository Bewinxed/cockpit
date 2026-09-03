<script lang="ts">
  import { Handle, Position, useStore, useSvelteFlow } from "@xyflow/svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import {
    IconChevronDown,
    IconChevronRight,
    IconError,
    IconLayers,
    IconSkill,
    IconSpinner,
    IconSuccess,
  } from "$lib/icons";
  import {
    BRANCH_COLORS_FALLBACK,
    ELAPSED_TIME_UPDATE_INTERVAL,
    SUBAGENT_RESULT_MAX_CHARS,
    ZOOM_THRESHOLD_OVERVIEW,
    ZOOM_THRESHOLD_SUMMARY,
  } from "$lib/utils/flow-constants";
  import type { SubagentState } from "$lib/utils/flow-types";
  import { getToolGlance, getToolStatus } from "$lib/utils/tool-display";
  import { modelLabel } from "$lib/whiffle/models.svelte";
  import type { Message } from "$lib/whiffle/types";
  import { toolFamily } from "../../tool-cards/descriptors";

  // Props passed by SvelteFlow
  interface Props {
    data: {
      subagent?: SubagentState;
      subagents?: SubagentState[];
      depth?: number;
      branchColor?: string;
    };
    id: string;
  }

  let { id, data }: Props = $props();

  // Get store for zoom level
  const { viewport } = $derived(useStore());
  const { fitView } = useSvelteFlow();
  const zoom = $derived(viewport.zoom);

  // Expansion state - track which subagents are expanded by toolUseId
  let expandedSet = $state(new Set<string>());

  // Semantic zoom levels
  const zoomLevel = $derived(
    zoom < ZOOM_THRESHOLD_OVERVIEW
      ? "overview"
      : zoom < ZOOM_THRESHOLD_SUMMARY
        ? "summary"
        : "detail"
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
    if (allSubagents.length === 0) {
      return "starting";
    }
    const statuses = allSubagents.map((s) => s.status);
    if (statuses.some((s) => s === "error")) {
      return "error";
    }
    if (statuses.some((s) => s === "running")) {
      return "running";
    }
    if (statuses.some((s) => s === "starting")) {
      return "starting";
    }
    if (statuses.every((s) => s === "complete")) {
      return "complete";
    }
    return "running";
  });

  // Total tool count across all subagents
  const totalToolCount = $derived(
    allSubagents.reduce((sum, s) => sum + (s.messages?.length || 0), 0)
  );

  /** The dot is the only status cue at overview zoom, so it says the word too. */
  const STATUS_LABEL: Record<string, string> = {
    starting: "Starting",
    running: "Running",
    complete: "Complete",
    error: "Error",
  };

  const statusLabel = (status: string) => STATUS_LABEL[status] ?? status;

  // Status styling helpers
  function getStatusIcon(status: string) {
    switch (status) {
      case "complete":
        return IconSuccess;
      case "error":
        return IconError;
      default:
        return IconSpinner;
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case "complete":
        return "text-success";
      case "error":
        return "text-error";
      case "running":
        return "text-info";
      default:
        return "text-muted-foreground";
    }
  }

  function _getBorderClass(status: string): string {
    switch (status) {
      case "complete":
        return "border-success";
      case "error":
        return "border-error";
      case "running":
        return "border-info animate-pulse";
      default:
        return "border-info";
    }
  }

  // Get tool messages for a subagent
  function getToolMessages(subagent: SubagentState): Message[] {
    return (
      subagent.messages?.filter((m: Message) => m.type === "tool.use") || []
    );
  }

  // Get child subagents (nested) from the branch this node was handed
  function getChildSubagents(subagent: SubagentState): SubagentState[] {
    return allSubagents.filter(
      (child) => child.parentSubagentId === subagent.toolUseId
    );
  }

  // Format elapsed time
  function formatElapsed(subagent: SubagentState): string {
    let ms = 0;
    if (subagent.status === "running" || subagent.status === "starting") {
      const startTime = subagent.startedAt
        ? new Date(subagent.startedAt).getTime()
        : Date.now();
      ms = Date.now() - startTime;
    } else if (subagent.completedAt && subagent.startedAt) {
      ms =
        new Date(subagent.completedAt).getTime() -
        new Date(subagent.startedAt).getTime();
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}s`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }

  // Current action for a subagent
  function getCurrentAction(subagent: SubagentState): string {
    if (subagent.status !== "running") {
      return "";
    }
    const lastMsg = subagent.messages?.[subagent.messages.length - 1];
    if (lastMsg?.type === "tool.use") {
      return lastMsg.metadata?.toolName || "Working...";
    }
    return "Working...";
  }

  // Toggle expansion for a specific subagent
  function toggleExpanded(toolUseId: string) {
    const newSet = new Set(expandedSet);
    if (newSet.has(toolUseId)) {
      newSet.delete(toolUseId);
    } else {
      newSet.add(toolUseId);
    }
    expandedSet = newSet;
  }

  // Click to zoom into branch (when in detail view)
  const zoomable = $derived(zoomLevel !== "detail");

  function handleClick() {
    if (zoomable) {
      fitView({ nodes: [{ id }], duration: 300 });
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    handleClick();
  }

  // Spread, not attributes: at detail zoom the click does nothing, and a node
  // that announces itself as a button with nothing behind it is worse than none.
  const zoomAction = $derived(
    zoomable
      ? {
          role: "button" as const,
          tabindex: 0,
          "aria-label": "Zoom to this subagent branch",
          onclick: handleClick,
          onkeydown: handleKeydown,
        }
      : {}
  );

  // Get tool icon color based on status
  function getToolStatusColor(msg: Message): string {
    const status = getToolStatus(msg.metadata);
    switch (status) {
      case "success":
        return "text-success";
      case "error":
        return "text-error";
      default:
        return "text-warning";
    }
  }

  // Force re-render every second for elapsed time
  // Uses a stable interval that's only created/destroyed based on running status
  let tick = $state(0);
  let intervalId = $state<ReturnType<typeof setInterval> | null>(null);

  $effect(() => {
    const hasRunning = allSubagents.some(
      (s) => s.status === "running" || s.status === "starting"
    );

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

<Handle
  position={Position.Top}
  style="background: {branchColor}"
  type="target"
/>

<div
  class="subagent-node rounded-[var(--radius-card)] shadow-sm bg-card p-3 w-[320px] transition-colors {zoomable
    ? 'cursor-pointer hover:bg-accent hover:text-accent-foreground/50 focus-visible:ring-2 focus-visible:ring-ring'
    : ''}"
  {...zoomAction}
>
  {#if zoomLevel === 'overview'}
    <!-- Overview: just icons -->
    <div class="flex items-center justify-center gap-2">
      {#if isParallel}
        <span class="text-xs font-medium text-muted-foreground"
          >{allSubagents.length}×</span
        >
      {/if}
      <div
        class="rounded-full p-2"
        style="background: color-mix(in oklab, {branchColor} 15%, transparent)"
      >
        <IconSkill class="h-4 w-4" style="color: {branchColor}" />
      </div>
      <div
        class="w-2 h-2 rounded-full {getStatusColor(groupStatus) === 'text-success'
          ? 'bg-success'
          : getStatusColor(groupStatus) === 'text-error'
            ? 'bg-error'
            : 'bg-info'}"
        title={statusLabel(groupStatus)}
      ></div>
    </div>
  {:else if zoomLevel === 'summary'}
    <!-- Summary: one line per subagent -->
    <div class="space-y-1">
      {#if isParallel}
        <div class="flex items-center gap-1 text-xs text-muted-foreground mb-1">
          <IconLayers class="h-3 w-3" />
          <span>{allSubagents.length} parallel agents</span>
        </div>
      {/if}
      {#each allSubagents as subagent (subagent.toolUseId)}
        {@const SubIcon = getStatusIcon(subagent.status)}
        <div class="flex items-center gap-2">
          <IconSkill class="h-3 w-3 shrink-0" style="color: {branchColor}" />
          <span class="text-sm font-medium truncate"
            >{subagent.subagentType}</span
          >
          {#if subagent.model}
            <span class="truncate text-xs text-muted-foreground"
              >{modelLabel(subagent.model)}</span
            >
          {/if}
          {#if subagent.messages?.length}
            <span class="text-xs bg-muted px-1 py-0.5 rounded"
              >{subagent.messages.length}</span
            >
          {/if}
          <SubIcon
            class="h-3 w-3 ml-auto {getStatusColor(subagent.status)} {subagent.status === 'running' ? 'animate-spin' : ''}"
          />
        </div>
      {/each}
    </div>
  {:else}
    <!-- Detail: full info for each subagent -->
    <div class="space-y-3">
      {#if isParallel}
        <div class="flex items-center gap-2 pb-2 border-b border-border">
          <IconLayers class="h-4 w-4 text-muted-foreground" />
          <span class="text-sm font-medium"
            >{allSubagents.length}
            Parallel Agents</span
          >
          <span class="text-xs text-muted-foreground ml-auto"
            >{totalToolCount}
            tools total</span
          >
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
            <IconSkill class="h-4 w-4 shrink-0" style="color: {branchColor}" />
            <span class="text-sm font-medium">{subagent.subagentType}</span>
            {#if subagent.model}
              <span class="shrink-0 text-xs text-muted-foreground"
                >{modelLabel(subagent.model)}</span
              >
            {/if}
            <SubIcon
              class="h-4 w-4 ml-auto {getStatusColor(subagent.status)} {subagent.status === 'running' ? 'animate-spin' : ''}"
            />
          </div>

          <!-- Status line -->
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{statusLabel(subagent.status)}</span>
            <span>|</span>
            <!-- Only the clock re-renders on a tick; the node around it does not. -->
            <span
              >{#key tick}
                {formatElapsed(subagent)}
              {/key}</span
            >
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
            <div class="text-xs text-info">→ {getCurrentAction(subagent)}</div>
          {/if}

          <!-- Expand/collapse -->
          {#if toolMessages.length > 0 || childSubagents.length > 0}
            <Collapsible.Root
              class="space-y-2"
              onOpenChange={() => toggleExpanded(subagent.toolUseId)}
              open={isExpanded}
            >
              <Collapsible.Trigger
                class="flex w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onclick={(e: MouseEvent) => e.stopPropagation()}
              >
                {#if isExpanded}
                  <IconChevronDown class="h-3 w-3" />
                  <span>Hide details</span>
                {:else}
                  <IconChevronRight class="h-3 w-3" />
                  <span
                    >Show
                    {toolMessages.length}
                    tools{childSubagents.length > 0 ? `, ${childSubagents.length} nested` : ''}</span
                  >
                {/if}
              </Collapsible.Trigger>

              <!-- Expanded content -->
              <Collapsible.Content>
                <div class="border-t border-border/50 pt-2 space-y-1">
                  {#each toolMessages as tool (tool.metadata?.toolId)}
                    {@const family = toolFamily(tool.metadata?.toolName)}
                    <div
                      class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/50"
                    >
                      <!-- The family's face, but the status's ink: this row has
                           nowhere else to say how the call went. -->
                      <family.icon
                        class="h-3 w-3 {getToolStatusColor(tool)} shrink-0"
                      />
                      <span class="font-medium"
                        >{tool.metadata?.toolName || 'Tool'}</span
                      >
                      <span class="text-muted-foreground truncate">
                        {getToolGlance(tool.metadata?.toolInput as Record<string, unknown>) || ''}
                      </span>
                    </div>
                  {/each}

                  {#each childSubagents as child (child.toolUseId)}
                    <div
                      class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-info/10"
                    >
                      <div
                        class="w-1.5 h-1.5 rounded-full bg-info shrink-0"
                      ></div>
                      <IconSkill class="h-3 w-3 text-info shrink-0" />
                      <span class="font-medium">{child.subagentType}</span>
                      <span class="text-muted-foreground"
                        >{statusLabel(child.status)}</span
                      >
                      {#if child.messages.length > 0}
                        <span class="text-xs bg-muted px-1 rounded"
                          >{child.messages.length}</span
                        >
                      {/if}
                    </div>
                  {/each}

                  {#if subagent.status === 'complete' && subagent.result}
                    <div
                      class="text-xs text-muted-foreground bg-muted/30 p-2 rounded max-h-20 overflow-y-auto"
                    >
                      <span class="font-medium">Result: </span>
                      {subagent.result.slice(0, SUBAGENT_RESULT_MAX_CHARS)}
                      {subagent.result.length > SUBAGENT_RESULT_MAX_CHARS ? '...' : ''}
                    </div>
                  {/if}
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          {/if}
        </div>
      {/each}

      {#if depth >= 3}
        <div
          class="flex items-center gap-1 text-xs text-muted-foreground pt-2 border-t border-border"
        >
          <IconLayers class="h-3 w-3" />
          <span>+{depth - 2} nested levels</span>
        </div>
      {/if}
    </div>
  {/if}
</div>

<Handle
  position={Position.Bottom}
  style="background: {branchColor}"
  type="source"
/>
