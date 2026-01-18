<script lang="ts">
  import { useSvelteFlow, type Node } from '@xyflow/svelte';
  import { onMount } from 'svelte';
  import {
    NODE_WIDTH,
    NODE_HEIGHT_ESTIMATE,
    NODE_CENTER_X,
    NODE_CENTER_Y,
    VISIBILITY_MARGIN,
    ANIMATION_DURATION,
    INITIAL_PAN_DELAY,
    ZOOM_DEFAULT,
  } from '$lib/utils/flow-constants';

  interface Props {
    nodeCount: number;
    nodes: Node[];
  }

  let { nodeCount, nodes }: Props = $props();

  const { setCenter, getZoom, getViewport } = useSvelteFlow();

  // Track previous count to detect new nodes
  let prevCount = $state(0);
  // Reset on every mount to ensure we pan to latest when switching views
  let hasInitialized = $state(false);

  /**
   * Check if a number is valid (not NaN, not Infinity)
   */
  function isValidNumber(n: unknown): n is number {
    return typeof n === 'number' && !isNaN(n) && isFinite(n);
  }

  /**
   * Check if a node is approximately visible in the viewport
   */
  function isNodeVisible(node: Node): boolean {
    try {
      const viewport = getViewport();

      // Validate viewport values
      if (!isValidNumber(viewport.x) || !isValidNumber(viewport.y) || !isValidNumber(viewport.zoom) || viewport.zoom <= 0) {
        return false;
      }

      // Validate node position
      if (!isValidNumber(node.position.x) || !isValidNumber(node.position.y)) {
        return false;
      }

      // Get viewport bounds in flow coordinates
      const viewLeft = -viewport.x / viewport.zoom;
      const viewTop = -viewport.y / viewport.zoom;
      // Use actual window dimensions
      const viewRight = viewLeft + (window.innerWidth / viewport.zoom);
      const viewBottom = viewTop + (window.innerHeight / viewport.zoom);

      const nodeRight = node.position.x + NODE_WIDTH;
      const nodeBottom = node.position.y + NODE_HEIGHT_ESTIMATE;

      // Check if node overlaps with viewport (with margin)
      return !(
        node.position.x > viewRight + VISIBILITY_MARGIN ||
        nodeRight < viewLeft - VISIBILITY_MARGIN ||
        node.position.y > viewBottom + VISIBILITY_MARGIN ||
        nodeBottom < viewTop - VISIBILITY_MARGIN
      );
    } catch {
      // If we can't determine visibility, assume not visible (pan to it)
      return false;
    }
  }

  /**
   * Pan to a node's center
   * @param node - The node to pan to
   * @param duration - Animation duration in ms
   * @param zoom - Optional zoom level (if not provided, preserves current zoom)
   */
  function panToNode(node: Node, duration: number = ANIMATION_DURATION, zoom?: number) {
    try {
      // Use provided zoom or fall back to current zoom
      const targetZoom = zoom ?? getZoom();

      // Validate zoom
      if (!isValidNumber(targetZoom) || targetZoom <= 0) {
        return;
      }

      // Validate node position
      if (!isValidNumber(node.position.x) || !isValidNumber(node.position.y)) {
        return;
      }

      const targetX = node.position.x + NODE_CENTER_X;
      const targetY = node.position.y + NODE_CENTER_Y;

      // Final validation before calling setCenter
      if (isValidNumber(targetX) && isValidNumber(targetY)) {
        setCenter(targetX, targetY, { zoom: targetZoom, duration });
      }
    } catch {
      // setCenter may throw if viewport not ready
    }
  }

  /**
   * Check if nodes have valid (non-zero, non-NaN) positions
   */
  function hasValidPositions(): boolean {
    if (nodes.length === 0) return false;
    const lastNode = nodes[nodes.length - 1];
    if (!lastNode) return false;
    // Check for NaN or Infinity
    if (!isValidNumber(lastNode.position.x) || !isValidNumber(lastNode.position.y)) return false;
    // Check for zero positions (dagre hasn't run yet)
    // Allow (0,0) only if there's just one node
    if (nodes.length > 1 && lastNode.position.x === 0 && lastNode.position.y === 0) return false;
    return true;
  }

  // Pan to latest node on mount (when switching to flow view)
  onMount(() => {
    // Reset state on mount
    hasInitialized = false;
    prevCount = 0;

    // Retry panning until positions are valid or max attempts reached
    let attempts = 0;
    const maxAttempts = 10;
    const retryDelay = 50;

    function tryPan() {
      attempts++;

      if (hasValidPositions()) {
        const lastNode = nodes[nodes.length - 1];
        // Use ZOOM_DEFAULT for initial pan instead of preserving fitView's zoom
        panToNode(lastNode, ANIMATION_DURATION, ZOOM_DEFAULT);
        hasInitialized = true;
        prevCount = nodes.length;
      } else if (attempts < maxAttempts) {
        // Retry after a short delay
        setTimeout(tryPan, retryDelay);
      } else {
        // Give up after max attempts, just mark as initialized
        hasInitialized = true;
        prevCount = nodes.length;
      }
    }

    // Start trying after initial delay
    const timer = setTimeout(tryPan, INITIAL_PAN_DELAY);

    return () => clearTimeout(timer);
  });

  // Watch for new nodes being added after initialization
  $effect(() => {
    // Skip if not initialized yet (onMount handles initial pan)
    if (!hasInitialized) {
      return;
    }

    if (nodeCount > prevCount && nodeCount > 0) {
      const lastNode = nodes[nodes.length - 1];

      if (lastNode && isValidNumber(lastNode.position.x) && isValidNumber(lastNode.position.y)) {
        // Only pan if new node is outside viewport
        if (!isNodeVisible(lastNode)) {
          panToNode(lastNode, ANIMATION_DURATION);
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
