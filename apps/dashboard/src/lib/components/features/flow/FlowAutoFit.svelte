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
  let hasInitialized = $state(false);

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

  // Pan to latest node on initial mount (when switching to flow view)
  // and when new nodes are added
  $effect(() => {
    if (nodeCount > 0) {
      const lastNode = nodes[nodes.length - 1];

      // Validate node position
      if (lastNode && !isNaN(lastNode.position.x) && !isNaN(lastNode.position.y)) {
        // On initial mount, always pan to latest node
        if (!hasInitialized) {
          hasInitialized = true;
          // Small delay to let layout settle after initial render
          setTimeout(() => {
            const currentZoom = getZoom();
            // Validate zoom before using
            if (typeof currentZoom === 'number' && !isNaN(currentZoom) && currentZoom > 0) {
              setCenter(
                lastNode.position.x + 160,
                lastNode.position.y + 60,
                { zoom: currentZoom, duration: 300 }
              );
            }
          }, 100);
        }
        // On subsequent updates, only pan if new node is outside viewport
        else if (nodeCount > prevCount) {
          if (!isNodeVisible(lastNode)) {
            const currentZoom = getZoom();
            if (typeof currentZoom === 'number' && !isNaN(currentZoom) && currentZoom > 0) {
              setCenter(
                lastNode.position.x + 160,
                lastNode.position.y + 60,
                { zoom: currentZoom, duration: 300 }
              );
            }
          }
        }
      }
    }
    prevCount = nodeCount;
  });
</script>

<!--
  Smart auto-pan behavior:
  - On initial mount (switching to flow view): pans to the latest node
  - On new nodes: only pans if the new node is outside the visible viewport
  Preserves user's current zoom level and doesn't disrupt if already viewing the area.
-->
