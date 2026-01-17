<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    MiniMap,
    Panel,
    type Node,
    type Edge,
    type DefaultEdgeOptions,
    BackgroundVariant
  } from '@xyflow/svelte';
  import { instances, ui } from '$lib/stores';
  import FlowContextMenu from './FlowContextMenu.svelte';
  import FlowAutoFit from './FlowAutoFit.svelte';
  import { nodeTypes } from './nodes';
  import { transformMessagesToFlow } from '$lib/utils/flow-transform';
  import { applyLayout } from '$lib/utils/flow-layout';

  interface Props {
    instanceId: string;
  }

  let { instanceId }: Props = $props();

  // Get messages from store
  const messages = $derived(instances.getMessages(instanceId));

  // Get active subagents for subagent node data
  const subagentsMap = $derived.by(() => {
    const subagents = instances.getActiveSubagentsForInstance(instanceId);
    return new Map(subagents.map(s => [s.toolUseId, s]));
  });

  // Check if any tool is currently streaming
  const streamingMessage = $derived(instances.getStreamingMessage(instanceId));
  const streamingToolId = $derived(streamingMessage?.sdkUuid);

  // Transform messages to raw flow data (nodes/edges without positions)
  const rawFlowData = $derived.by(() => {
    return transformMessagesToFlow(messages, instanceId, {
      subagents: subagentsMap,
      streamingToolId,
    });
  });

  // Derive layout once, then extract nodes/edges
  const layoutData = $derived.by(() => {
    const { nodes: rawNodes, edges: rawEdges } = rawFlowData;
    if (rawNodes.length === 0) return { nodes: [] as Node[], edges: [] as Edge[] };
    return applyLayout(rawNodes, rawEdges);
  });

  const nodes = $derived(layoutData.nodes);
  const edges = $derived(layoutData.edges);

  // Context menu state
  let contextMenu = $state<{ x: number; y: number; nodeId: string } | null>(null);

  // Default edge styling - smooth bezier curves
  const defaultEdgeOptions: DefaultEdgeOptions = {
    type: 'smoothstep',
    animated: false,
    style: 'stroke-width: 2px;'
  };

  // Get instance for cost display
  const instance = $derived(instances.get(instanceId));
  const totalCost = $derived(instance?.totalCostUsd?.toFixed(4) ?? '0.0000');

  // Handle node context menu - svelte-flow passes { node, event }
  function handleNodeContextMenu({ node, event }: { node: Node; event: MouseEvent }) {
    event.preventDefault();
    contextMenu = {
      x: event.clientX,
      y: event.clientY,
      nodeId: node.id
    };
  }

  // Close context menu
  function closeContextMenu() {
    contextMenu = null;
  }

  // Handle context menu actions
  function handleContextAction(action: string, nodeId: string) {
    switch (action) {
      case 'copy': {
        // Copy node content to clipboard
        const node = nodes.find(n => n.id === nodeId);
        if (node?.data?.content) {
          navigator.clipboard.writeText(String(node.data.content));
        }
        break;
      }
      case 'rewind':
        // TODO: Implement rewind to this message
        console.log('Rewind to:', nodeId);
        break;
      case 'branch':
        // TODO: Implement branch from this message
        console.log('Branch from:', nodeId);
        break;
      case 'jump':
        // Switch to chat view (scrolling to message is future enhancement)
        ui.setViewMode(instanceId, 'chat');
        break;
    }
    closeContextMenu();
  }

  // Close context menu on click outside
  function handlePaneClick() {
    closeContextMenu();
  }
</script>

<div class="relative h-full w-full">
  <SvelteFlow
    {nodes}
    {edges}
    {nodeTypes}
    {defaultEdgeOptions}
    fitView
    onlyRenderVisibleElements={true}
    minZoom={0.1}
    maxZoom={2}
    onpaneclick={handlePaneClick}
    onnodecontextmenu={handleNodeContextMenu}
    class="flow-animated"
  >
    <!-- Background grid -->
    <Background variant={BackgroundVariant.Dots} gap={20} size={1} />

    <!-- Auto-pan to new nodes (must be inside SvelteFlow context) -->
    <FlowAutoFit nodeCount={nodes.length} {nodes} />

    <!-- Controls - zoom, fit, lock -->
    <Controls position="bottom-left" showZoom showFitView showLock />

    <!-- MiniMap - always visible -->
    <MiniMap
      position="bottom-right"
      pannable
      zoomable
      class="!bg-background/80 !border-border"
    />

    <!-- Header panel with cost display -->
    <Panel position="top-right" class="!bg-transparent">
      <div class="flex items-center gap-2 rounded-md bg-background/80 backdrop-blur-sm px-3 py-1.5 border border-border text-sm">
        <span class="text-muted-foreground">Cost:</span>
        <span class="font-mono text-foreground">${totalCost}</span>
      </div>
    </Panel>

    <!-- Empty state when no messages -->
    {#if nodes.length === 0}
      <Panel position="top-left" class="!bg-transparent">
        <div class="flex items-center gap-2 rounded-md bg-background/80 backdrop-blur-sm px-4 py-3 border border-border">
          <span class="text-muted-foreground">Flow view ready. Messages will appear as nodes.</span>
        </div>
      </Panel>
    {/if}
  </SvelteFlow>

  <!-- Context menu -->
  {#if contextMenu}
    <FlowContextMenu
      x={contextMenu.x}
      y={contextMenu.y}
      onAction={(action) => handleContextAction(action, contextMenu!.nodeId)}
      onClose={closeContextMenu}
    />
  {/if}
</div>

<style>
  /* Override svelte-flow default styles to match dashboard theme */
  :global(.svelte-flow) {
    --xy-background-color: transparent;
    --xy-minimap-background-color: hsl(var(--background) / 0.8);
  }

  /* Smooth transitions for node positions */
  :global(.flow-animated .svelte-flow__node) {
    transition: transform 0.3s ease-out;
  }

  /* Smooth edge path transitions */
  :global(.flow-animated .svelte-flow__edge path) {
    transition: d 0.3s ease-out;
  }

  :global(.svelte-flow__controls) {
    background: hsl(var(--background) / 0.8);
    border: 1px solid hsl(var(--border));
    border-radius: 0.375rem;
    backdrop-filter: blur(4px);
  }

  :global(.svelte-flow__controls button) {
    background: transparent;
    border: none;
    color: hsl(var(--foreground));
  }

  :global(.svelte-flow__controls button:hover) {
    background: hsl(var(--muted));
  }

  :global(.svelte-flow__minimap) {
    background: hsl(var(--background) / 0.8) !important;
    border: 1px solid hsl(var(--border)) !important;
    border-radius: 0.375rem;
  }
</style>
