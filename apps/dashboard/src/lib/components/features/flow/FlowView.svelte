<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    type ColorMode,
    Controls,
    type DefaultEdgeOptions,
    type Edge,
    MiniMap,
    type Node,
    Panel,
    SvelteFlow,
  } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { onMount } from "svelte";
  import { theme } from "$lib/theme.svelte";
  import {
    ZOOM_MAX,
    ZOOM_MIN,
    ZOOM_THRESHOLD_LAYOUT,
  } from "$lib/utils/flow-constants";
  import { applyLayout, type ZoomMode } from "$lib/utils/flow-layout";
  import { transformMessagesToFlow } from "$lib/utils/flow-transform";
  import type { ContextMenuAction, SubagentState } from "$lib/utils/flow-types";
  import { copyToClipboard } from "$lib/whiffle/copy";
  import type { Message } from "$lib/whiffle/types";
  import FlowAutoFit from "./FlowAutoFit.svelte";
  import FlowContextMenu from "./FlowContextMenu.svelte";
  import FlowZoomTracker from "./FlowZoomTracker.svelte";
  import { nodeTypes } from "./nodes";

  interface Props {
    instanceId: string;
    messages: Message[];
    /** Invoked by the context menu's "jump to chat". */
    onJump?: (nodeId: string) => void;
    /** The tool whose output is still streaming, if any. */
    streamingToolId?: string;
    /** Subagent branches to draw, keyed by the Task tool.use that spawned them. */
    subagents?: Map<string, SubagentState>;
    totalCostUsd?: number;
  }

  let {
    instanceId,
    messages,
    subagents: subagentsMap = new Map(),
    streamingToolId,
    totalCostUsd = 0,
    onJump,
  }: Props = $props();

  // Transform messages to raw flow data (nodes/edges without positions)
  const rawFlowData = $derived.by(() =>
    transformMessagesToFlow(messages, instanceId, {
      subagents: subagentsMap,
      streamingToolId,
    })
  );

  // Derive layout with dagre hierarchical positioning
  // Re-computes when zoomMode changes for dynamic spacing
  const layoutData = $derived.by(() => {
    const { nodes: rawNodes, edges: rawEdges } = rawFlowData;
    if (rawNodes.length === 0) {
      return { nodes: [] as Node[], edges: [] as Edge[] };
    }
    return applyLayout(rawNodes, rawEdges, { zoomMode });
  });

  const nodes = $derived(layoutData.nodes);
  const edges = $derived(layoutData.edges);

  // Viewport zoom tracking for dynamic layout
  let currentZoom = $state(1);

  // Derive zoom mode from current zoom level
  // compact: zoomed out (overview/summary), expanded: zoomed in (detail)
  const zoomMode = $derived<ZoomMode>(
    currentZoom >= ZOOM_THRESHOLD_LAYOUT ? "expanded" : "compact"
  );

  // Derive colorMode from app theme for svelte-flow dark mode support
  const colorMode = $derived<ColorMode>(theme.current);

  // Context menu state
  let contextMenu = $state<{ x: number; y: number; nodeId: string } | null>(
    null
  );

  // Transitions disabled state (controlled by FlowZoomTracker)
  let transitionsDisabled = $state(false);

  // Track if component has mounted (delays initial SvelteFlow render to avoid NaN errors)
  let mounted = $state(false);

  // Track if SvelteFlow has initialized (viewport is valid)
  let flowReady = $state(false);

  // Default edge styling - smooth bezier curves
  const defaultEdgeOptions: DefaultEdgeOptions = {
    type: "smoothstep",
    animated: false,
    style: "stroke-width: 2px;",
  };

  // Delay SvelteFlow render until after mount to avoid initial NaN viewport errors
  onMount(() => {
    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      mounted = true;
    });
  });

  const totalCost = $derived(totalCostUsd.toFixed(4));

  // Handle node context menu - svelte-flow passes { node, event }
  function handleNodeContextMenu({
    node,
    event,
  }: {
    node: Node;
    event: MouseEvent;
  }) {
    event.preventDefault();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id,
    };
  }

  // Close context menu
  function closeContextMenu() {
    contextMenu = null;
  }

  // Handle context menu actions
  function handleContextAction(action: ContextMenuAction, nodeId: string) {
    switch (action) {
      case "copy": {
        const node = nodes.find((n) => n.id === nodeId);
        if (node?.data?.content) {
          void copyToClipboard("Message", String(node.data.content));
        }
        break;
      }
      case "jump":
        onJump?.(nodeId);
        break;
    }
    closeContextMenu();
  }

  // Close context menu on click outside
  function handlePaneClick() {
    closeContextMenu();
  }

  // Callback from FlowZoomTracker when zoom changes
  function handleZoomChange(zoom: number) {
    currentZoom = zoom;
  }

  // Callback from FlowZoomTracker when transitions should be disabled
  function handleTransitionsDisabled(disabled: boolean) {
    transitionsDisabled = disabled;
  }

  // Callback when SvelteFlow initializes
  function handleInit() {
    // Small delay to ensure viewport is fully initialized
    setTimeout(() => {
      flowReady = true;
    }, 50);
  }
</script>

<div class="relative h-full w-full">
  {#if mounted}
    <SvelteFlow
      class="flow-animated {transitionsDisabled ? 'transitions-disabled' : ''}"
      {colorMode}
      {defaultEdgeOptions}
      {edges}
      maxZoom={ZOOM_MAX}
      minZoom={ZOOM_MIN}
      {nodes}
      {nodeTypes}
      oninit={handleInit}
      onlyRenderVisibleElements={true}
      onnodecontextmenu={handleNodeContextMenu}
      onpaneclick={handlePaneClick}
    >
      <!-- Background grid - only render after viewport is ready to avoid NaN errors -->
      {#if flowReady}
        <Background gap={20} size={1} variant={BackgroundVariant.Dots} />
      {/if}

      <!-- Track zoom level for dynamic layout spacing, handles re-centering on threshold cross -->
      {#if flowReady}
        <FlowZoomTracker
          {nodes}
          onTransitionsDisabled={handleTransitionsDisabled}
          onZoomChange={handleZoomChange}
        />
      {/if}

      <!-- Auto-pan to new nodes (must be inside SvelteFlow context) -->
      {#if flowReady}
        <FlowAutoFit nodeCount={nodes.length} {nodes} />
      {/if}

      <!-- Controls - zoom, fit, lock -->
      <Controls position="bottom-left" showFitView showLock showZoom />

      <!-- MiniMap - only render after viewport is ready to avoid NaN errors -->
      {#if flowReady}
        <MiniMap
          class="!bg-background/80 !border-border"
          pannable
          position="bottom-right"
          zoomable
        />
      {/if}

      <!-- Header panel with cost display -->
      <Panel class="!bg-transparent" position="top-right">
        <div
          class="flex items-center gap-2 rounded-[var(--radius-control)] bg-background/80 backdrop-blur-sm px-3 py-1.5 border border-border text-sm"
        >
          <span class="text-muted-foreground">Cost:</span>
          <span class="font-mono text-foreground">${totalCost}</span>
        </div>
      </Panel>

      <!-- Empty state when no messages -->
      {#if nodes.length === 0}
        <Panel class="!bg-transparent" position="top-left">
          <div
            class="flex items-center gap-2 rounded-[var(--radius-control)] bg-background/80 backdrop-blur-sm px-4 py-3 border border-border"
          >
            <span class="text-muted-foreground"
              >Flow view ready. Messages will appear as nodes.</span
            >
          </div>
        </Panel>
      {/if}
    </SvelteFlow>
  {:else}
    <!-- Loading placeholder while SvelteFlow initializes -->
    <div class="h-full w-full flex items-center justify-center bg-background">
      <span class="text-muted-foreground">Loading flow view...</span>
    </div>
  {/if}

  <!-- Context menu -->
  {#if contextMenu}
    <FlowContextMenu
      onAction={(action) => handleContextAction(action as ContextMenuAction, contextMenu!.nodeId)}
      onClose={closeContextMenu}
      x={contextMenu.x}
      y={contextMenu.y}
    />
  {/if}
</div>

<style>
  /* Override svelte-flow default styles to match dashboard theme */
  :global(.svelte-flow) {
    --xy-background-color: transparent;
    --xy-minimap-background-color: color-mix(
      in srgb,
      var(--background) 80%,
      transparent
    );
    --xy-edge-stroke-default: var(--border);
    --xy-edge-stroke-width-default: 2;
    --xy-background-pattern-dot-color-default: var(--border);
  }

  /* Dark mode specific overrides */
  :global(.svelte-flow.dark) {
    --xy-edge-stroke-default: var(--muted-foreground);
    --xy-background-pattern-dot-color-default: var(--muted-foreground);
  }

  /* Smooth transitions for node positions */
  :global(.flow-animated .svelte-flow__node) {
    transition: transform 0.3s ease-out;
  }

  /* Smooth edge path transitions */
  :global(.flow-animated .svelte-flow__edge path) {
    transition: d 0.3s ease-out;
  }

  /* Disable transitions during layout threshold changes */
  :global(.flow-animated.transitions-disabled .svelte-flow__node) {
    transition: none !important;
  }

  :global(.flow-animated.transitions-disabled .svelte-flow__edge path) {
    transition: none !important;
  }

  :global(.svelte-flow__controls) {
    background: color-mix(in srgb, var(--background) 80%, transparent);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    backdrop-filter: blur(4px);
  }

  :global(.svelte-flow__controls button) {
    background: transparent;
    border: none;
    color: var(--foreground);
  }

  :global(.svelte-flow__controls button:hover) {
    background: var(--muted);
  }

  :global(.svelte-flow__minimap) {
    background: color-mix(
      in srgb,
      var(--background) 80%,
      transparent
    ) !important;
    border: 1px solid var(--border) !important;
    border-radius: 0.375rem;
  }
</style>
