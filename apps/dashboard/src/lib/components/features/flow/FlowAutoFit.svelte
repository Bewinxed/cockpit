<script lang="ts">
  import { type Node, useSvelteFlow } from "@xyflow/svelte";
  import { onMount } from "svelte";
  import {
    INITIAL_PAN_DELAY,
    NODE_HEIGHT_ESTIMATE,
    NODE_WIDTH,
    ZOOM_DEFAULT,
  } from "$lib/utils/flow-constants";

  interface Props {
    nodeCount: number;
    nodes: Node[];
  }

  let { nodeCount, nodes }: Props = $props();

  const { setViewport, getViewport, screenToFlowPosition } = useSvelteFlow();

  // Track previous count to detect new nodes
  let prevCount = $state(0);
  let hasInitialized = $state(false);

  function isValidNumber(n: unknown): n is number {
    return typeof n === "number" && !isNaN(n) && isFinite(n);
  }

  function isNodeVisible(node: Node): boolean {
    try {
      const viewport = getViewport();
      if (!isValidNumber(viewport.zoom) || viewport.zoom <= 0) {
        return false;
      }
      if (!(isValidNumber(node.position.x) && isValidNumber(node.position.y))) {
        return false;
      }

      const topLeft = screenToFlowPosition({ x: 0, y: 0 });
      const bottomRight = screenToFlowPosition({
        x: window.innerWidth,
        y: window.innerHeight,
      });

      const margin = 50;
      const nodeCenterX = node.position.x + NODE_WIDTH / 2;
      const nodeCenterY = node.position.y + NODE_HEIGHT_ESTIMATE / 2;

      return (
        nodeCenterX >= topLeft.x - margin &&
        nodeCenterX <= bottomRight.x + margin &&
        nodeCenterY >= topLeft.y - margin &&
        nodeCenterY <= bottomRight.y + margin
      );
    } catch {
      return false;
    }
  }

  /**
   * Center viewport on a node using direct setViewport (most reliable method)
   * Calculates viewport position to center the node in the screen
   */
  function centerOnNode(node: Node, animated = false) {
    try {
      if (!(isValidNumber(node.position.x) && isValidNumber(node.position.y))) {
        return;
      }

      // Node center in flow coordinates
      const nodeCenterX = node.position.x + NODE_WIDTH / 2;
      const nodeCenterY = node.position.y + NODE_HEIGHT_ESTIMATE / 2;

      // Get current zoom or use default
      const viewport = getViewport();
      const zoom =
        isValidNumber(viewport.zoom) && viewport.zoom > 0
          ? viewport.zoom
          : ZOOM_DEFAULT;

      // Calculate viewport position to center the node
      // Viewport x/y is the offset from origin, so we need to calculate
      // where the viewport should be to put node center at screen center
      const screenCenterX = window.innerWidth / 2;
      const screenCenterY = window.innerHeight / 2;

      // viewport.x = screenCenterX - nodeCenterX * zoom
      // viewport.y = screenCenterY - nodeCenterY * zoom
      const newX = screenCenterX - nodeCenterX * zoom;
      const newY = screenCenterY - nodeCenterY * zoom;

      if (!(isValidNumber(newX) && isValidNumber(newY))) {
        return;
      }

      setViewport({ x: newX, y: newY, zoom }, { duration: animated ? 300 : 0 });
    } catch {
      // setViewport may throw if not ready
    }
  }

  function hasValidPositions(): boolean {
    if (nodes.length === 0) {
      return false;
    }
    const lastNode = nodes[nodes.length - 1];
    if (!lastNode) {
      return false;
    }
    if (
      !(
        isValidNumber(lastNode.position.x) && isValidNumber(lastNode.position.y)
      )
    ) {
      return false;
    }
    if (
      nodes.length > 1 &&
      lastNode.position.x === 0 &&
      lastNode.position.y === 0
    ) {
      return false;
    }
    return true;
  }

  onMount(() => {
    hasInitialized = false;
    prevCount = 0;

    let attempts = 0;
    const maxAttempts = 20;
    const retryDelay = 50;

    function tryCenter() {
      attempts++;

      if (hasValidPositions()) {
        const lastNode = nodes[nodes.length - 1];
        // INSTANT - no animation for initial view
        centerOnNode(lastNode, false);
        hasInitialized = true;
        prevCount = nodes.length;
      } else if (attempts < maxAttempts) {
        setTimeout(tryCenter, retryDelay);
      } else {
        hasInitialized = true;
        prevCount = nodes.length;
      }
    }

    const timer = setTimeout(tryCenter, INITIAL_PAN_DELAY);
    return () => clearTimeout(timer);
  });

  $effect(() => {
    if (!hasInitialized) {
      return;
    }

    if (nodeCount > prevCount && nodeCount > 0) {
      const lastNode = nodes[nodes.length - 1];
      if (
        lastNode &&
        isValidNumber(lastNode.position.x) &&
        isValidNumber(lastNode.position.y) &&
        !isNodeVisible(lastNode)
      ) {
        // Animate when following new nodes
        centerOnNode(lastNode, true);
      }
    }
    prevCount = nodeCount;
  });
</script>
