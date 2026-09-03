<script lang="ts">
  import { Handle, Position, useStore } from "@xyflow/svelte";
  import {
    IconDatabase,
    IconInfo,
    IconSettings,
    IconTerminal,
    IconWarningTriangle,
  } from "$lib/icons";
  import type { Message } from "$lib/whiffle/types";

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
    zoom < 0.5 ? "overview" : zoom < 1.0 ? "summary" : "detail"
  );

  const subtype = $derived.by(() => {
    const type = data?.message?.type;
    if (type?.startsWith("system.")) {
      return type.slice("system.".length);
    }
    if (type?.startsWith("result.")) {
      return type.slice("result.".length);
    }
    if (type?.startsWith("ui.")) {
      return type.slice("ui.".length);
    }
    return data?.message?.metadata?.subtype || "status";
  });
  const displayContent = $derived(
    (data?.content || data?.message?.content || "") as string
  );

  // Icon based on subtype
  const IconComponent = $derived.by(() => {
    switch (subtype) {
      case "init":
        return IconSettings;
      case "compact_boundary":
        return IconDatabase;
      case "terminal_setup_info":
        return IconTerminal;
      case "status":
        return IconInfo;
      case "error":
        return IconWarningTriangle;
      default:
        return IconInfo;
    }
  });

  // Color based on subtype
  const iconColor = $derived.by(() => {
    switch (subtype) {
      case "error":
        return "text-error";
      case "init":
        return "text-success";
      default:
        return "text-muted-foreground";
    }
  });
</script>

<Handle class="!bg-muted-foreground" position={Position.Top} type="target" />

<div
  class="system-message-node rounded-[var(--radius-card)] border border-border bg-muted/50 p-2 w-[320px]"
>
  {#if zoomLevel === 'overview'}
    <div class="flex items-center justify-center">
      <IconComponent class="h-4 w-4 {iconColor}" />
    </div>
  {:else if zoomLevel === 'summary'}
    <div class="flex items-center gap-2">
      <IconComponent class="h-4 w-4 {iconColor} shrink-0" />
      <span class="text-xs text-muted-foreground capitalize truncate"
        >{subtype.replaceAll('_', ' ')}</span
      >
    </div>
  {:else}
    <div class="flex items-start gap-2">
      <IconComponent class="h-4 w-4 {iconColor} shrink-0 mt-0.5" />
      <div class="flex-1 min-w-0">
        <div class="text-xs text-muted-foreground capitalize mb-1">
          {subtype.replaceAll('_', ' ')}
        </div>
        <div class="text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {displayContent}
        </div>
      </div>
    </div>
  {/if}
</div>

<Handle class="!bg-muted-foreground" position={Position.Bottom} type="source" />
