<script lang="ts">
  import { useSvelteFlow, type Node } from '@xyflow/svelte';

  interface Props {
    nodeCount: number;
    nodes: Node[];
  }

  let { nodeCount, nodes }: Props = $props();

  const { setCenter, getZoom, getViewport } = useSvelteFlow();

  // Track previous count to detect new nodes
  let prevCount = $state(0);

  // Check if a node is approximately visible in the viewport
  function isNodeVisible(node: Node): boolean {
    try {
      const viewport = getViewport();
      const nodeWidth = 320;
      const nodeHeight = 140;

      // Get viewport bounds in flow coordinates
      // viewport.x/y are the translation, zoom scales the view
      const viewLeft = -viewport.x / viewport.zoom;
      const viewTop = -viewport.y / viewport.zoom;
      // Use conservative estimate of screen size
      const viewRight = viewLeft + (1400 / viewport.zoom);
      const viewBottom = viewTop + (900 / viewport.zoom);

      const nodeRight = node.position.x + nodeWidth;
      const nodeBottom = node.position.y + nodeHeight;

      // Check if node overlaps with viewport (with some margin)
      const margin = 50;
      return !(node.position.x > viewRight + margin ||
               nodeRight < viewLeft - margin ||
               node.position.y > viewBottom + margin ||
               nodeBottom < viewTop - margin);
    } catch {
      // If we can't determine visibility, assume not visible (pan to it)
      return false;
    }
  }

  // Pan to new node when added, but only if it's not already visible
  $effect(() => {
    if (nodeCount > prevCount && nodeCount > 0) {
      const lastNode = nodes[nodes.length - 1];

      if (lastNode) {
        // Only pan if the new node is outside the current viewport
        if (!isNodeVisible(lastNode)) {
          const currentZoom = getZoom();
          const nodeHeight = 140;

          // Pan to show the new node, keeping current zoom
          setCenter(
            lastNode.position.x + 160,  // Center on node (half width)
            lastNode.position.y + nodeHeight / 2,  // Center vertically
            { zoom: currentZoom, duration: 300 }
          );
        }
      }
    }
    prevCount = nodeCount;
  });
</script>

<!--
  Smart auto-pan: only pans to new nodes if they're outside the visible viewport.
  Preserves user's current zoom level and doesn't disrupt if already viewing the area.
-->
