<script lang="ts">
  import { Handle, Position, useStore } from "@xyflow/svelte";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { IconCheck, IconClose, IconSpinner } from "$lib/icons";
  import {
    getResultGlimpse,
    getToolGlance,
    getToolStatus,
  } from "$lib/utils/tool-display";
  import type { Message } from "$lib/whiffle/types";
  import { toolFamily } from "../../tool-cards/descriptors";

  // Props passed by SvelteFlow
  let { data } = $props<{
    id: string;
    data: {
      messages?: Message[];
      isStreaming?: boolean;
      expanded?: boolean;
    };
  }>();

  // Get store for zoom level
  const { viewport } = $derived(useStore());
  const zoom = $derived(viewport.zoom);

  // Semantic zoom levels
  const zoomLevel = $derived(
    zoom < 0.5 ? "overview" : zoom < 1.0 ? "summary" : "detail"
  );

  // Get primary tool info (first in group)
  const primaryTool = $derived(data?.messages?.[0]);
  const toolName = $derived(primaryTool?.metadata?.toolName || "Tool");
  const toolInput = $derived(
    primaryTool?.metadata?.toolInput as Record<string, unknown> | undefined
  );
  const toolStatus = $derived(getToolStatus(primaryTool?.metadata));
  const glance = $derived(getToolGlance(toolInput));
  const toolCount = $derived(data?.messages?.length || 1);
  const isStreaming = $derived(data?.isStreaming || toolStatus === "pending");

  /** The dot is the only status cue at overview zoom, so it says the word too. */
  const statusLabel = $derived(
    isStreaming
      ? "Running"
      : toolStatus === "success"
        ? "Done"
        : toolStatus === "error"
          ? "Failed"
          : "Pending"
  );

  // The face and ink a tool wears everywhere else in the app.
  const family = $derived(toolFamily(toolName));

  // Status styling
  const statusClass = $derived.by(() => {
    if (isStreaming) {
      return "border-warning animate-pulse";
    }
    switch (toolStatus) {
      case "success":
        return "border-success";
      case "error":
        return "border-error";
      default:
        return "border-warning";
    }
  });

  const StatusIcon = $derived.by(() => {
    if (isStreaming) {
      return IconSpinner;
    }
    switch (toolStatus) {
      case "success":
        return IconCheck;
      case "error":
        return IconClose;
      default:
        return IconSpinner;
    }
  });

  const statusColor = $derived.by(() => {
    if (isStreaming) {
      return "text-warning";
    }
    switch (toolStatus) {
      case "success":
        return "text-success";
      case "error":
        return "text-error";
      default:
        return "text-warning";
    }
  });

  // Expanded state for detail view - use derived to react to data changes
  const initialExpanded = $derived(data?.expanded ?? false);
  let expanded = $state(false);

  // Sync expanded state when data.expanded changes externally
  $effect(() => {
    if (initialExpanded) {
      expanded = true;
    }
  });

  // Result preview
  const resultPreview = $derived(
    primaryTool?.metadata?.toolResult
      ? getResultGlimpse(primaryTool.metadata.toolResult, 100)
      : ""
  );
</script>

<Handle class="!bg-warning" position={Position.Top} type="target" />

<div
  class="tool-node rounded-[var(--radius-card)] shadow-sm bg-card p-3 w-[320px]"
>
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center gap-2">
      <div class="rounded-full bg-muted p-2">
        <family.icon class="h-4 w-4 {family.color}" />
      </div>
      <div
        class="w-2 h-2 rounded-full {statusColor === 'text-success'
          ? 'bg-success'
          : statusColor === 'text-error'
            ? 'bg-error'
            : 'bg-warning'}"
        title={statusLabel}
      ></div>
      {#if toolCount > 1}
        <span class="text-xs bg-muted px-1.5 py-0.5 rounded">{toolCount}</span>
      {/if}
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <family.icon class="h-4 w-4 {family.color} shrink-0" />
      <span class="text-sm font-medium">{toolName}</span>
      {#if glance}
        <span class="text-xs text-muted-foreground truncate">{glance}</span>
      {/if}
      <StatusIcon
        class="h-3 w-3 ml-auto {statusColor} {isStreaming ? 'animate-spin' : ''}"
      />
    </div>
  {:else}
    <div class="space-y-2">
      <div class="flex items-center gap-2">
        <family.icon class="h-4 w-4 {family.color} shrink-0" />
        <span class="text-sm font-medium">{toolName}</span>
        <StatusIcon
          class="h-4 w-4 ml-auto {statusColor} {isStreaming ? 'animate-spin' : ''}"
        />
      </div>

      {#if glance}
        <div
          class="text-xs text-muted-foreground font-mono bg-muted/50 px-2 py-1 rounded truncate"
        >
          {glance}
        </div>
      {/if}

      {#if toolCount > 1}
        <div class="text-xs text-muted-foreground">
          {toolCount}
          tools in this group
        </div>
      {/if}

      {#if resultPreview && !isStreaming}
        <Collapsible.Root
          onOpenChange={() => expanded = !expanded}
          open={expanded}
        >
          <Collapsible.Trigger
            class="w-full text-left focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div class="text-xs text-muted-foreground mb-1">
              Result {expanded ? '(collapse)' : '(expand)'}
            </div>
            {#if !expanded}
              <div
                class="text-xs font-mono bg-muted/50 px-2 py-1 rounded truncate"
              >
                {resultPreview}
              </div>
            {/if}
          </Collapsible.Trigger>

          <Collapsible.Content>
            <div
              class="text-xs font-mono bg-muted/50 px-2 py-1 rounded max-h-40 overflow-y-auto whitespace-pre-wrap"
            >
              {primaryTool?.metadata?.toolResult}
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      {/if}
    </div>
  {/if}
</div>

<Handle class="!bg-warning" position={Position.Bottom} type="source" />
