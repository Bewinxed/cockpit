<script lang="ts">
  import { useSvelteFlow, type Node } from '@xyflow/svelte';

  interface Props {
    nodeCount: number;
    nodes: Node[];
  }

  let { nodeCount, nodes }: Props = $props();

  const { setCenter, getZoom } = useSvelteFlow();

  // Track previous count to detect new nodes
  let prevCount = $state(0);

  // Pan to new node when added (keeping current zoom)
  $effect(() => {
    if (nodeCount > prevCount && nodeCount > 0) {
      // Find the last (newest) node - typically at the bottom of the flow
      const lastNode = nodes[nodes.length - 1];
      if (lastNode) {
        // Get current zoom level to maintain it
        const currentZoom = getZoom();

        // Center on the new node with smooth animation
        // Add offset for node height to center properly
        const nodeHeight = 140; // Approximate node height
        setCenter(
          lastNode.position.x + 160, // Half node width
          lastNode.position.y + nodeHeight / 2,
          { zoom: currentZoom, duration: 300 }
        );
      }
    }
    prevCount = nodeCount;
  });
</script>

<!-- This component has no visual output, it just handles auto-panning -->
