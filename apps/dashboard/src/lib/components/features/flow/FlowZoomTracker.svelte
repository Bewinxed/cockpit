<script lang="ts">
  import { useStore, useSvelteFlow, type Node } from '@xyflow/svelte';

  interface Props {
    onZoomChange: (zoom: number) => void;
    nodes: Node[];
  }

  let { onZoomChange, nodes }: Props = $props();

  const ZOOM_THRESHOLD = 1.0;

  // Get viewport and flow utilities
  const { viewport } = $derived(useStore());
  const { screenToFlowPosition, setViewport, getViewport } = useSvelteFlow();
  const zoom = $derived(viewport.zoom);

  // Track previous zoom to detect threshold crossings
  // Initialize with null to detect first valid zoom value
  let prevZoom = $state<number | null>(null);
  let prevMode = $state<'compact' | 'expanded' | null>(null);
  let isCompensating = $state(false);

  // Pending compensation after layout change
  let pendingCompensation = $state<{
    nodeId: string;
    oldPosition: { x: number; y: number };
  } | null>(null);

  // Find the node closest to a point
  function findClosestNode(point: { x: number; y: number }): Node | null {
    if (nodes.length === 0) return null;

    let closest: Node | null = null;
    let minDist = Infinity;

    for (const node of nodes) {
      const nodeCenterX = node.position.x + 160;
      const nodeCenterY = node.position.y + 20;
      const dist = Math.hypot(point.x - nodeCenterX, point.y - nodeCenterY);

      if (dist < minDist) {
        minDist = dist;
        closest = node;
      }
    }

    return closest;
  }

  // Disable CSS transitions on flow nodes
  function setTransitionsEnabled(enabled: boolean) {
    const flowContainer = document.querySelector('.flow-animated');
    if (flowContainer) {
      if (enabled) {
        flowContainer.classList.remove('transitions-disabled');
      } else {
        flowContainer.classList.add('transitions-disabled');
      }
    }
  }

  // Notify parent when zoom changes, detect threshold crossings
  $effect(() => {
    // Skip if zoom is invalid or we're in the middle of compensating
    if (typeof zoom !== 'number' || isNaN(zoom) || isCompensating) {
      return;
    }

    const newMode = zoom >= ZOOM_THRESHOLD ? 'expanded' : 'compact';

    // Initialize on first valid zoom
    if (prevZoom === null || prevMode === null) {
      prevZoom = zoom;
      prevMode = newMode;
      onZoomChange(zoom);
      return;
    }

    // Only process if zoom actually changed
    if (zoom !== prevZoom) {
      // Detect threshold crossing
      if (newMode !== prevMode && nodes.length > 0) {
        // Disable transitions for instant layout change
        setTransitionsEnabled(false);

        // Get the center of the viewport in flow coordinates
        const viewportCenterScreen = {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2,
        };
        const focalPoint = screenToFlowPosition(viewportCenterScreen);

        // Find the node closest to the focal point and record its OLD position
        const closestNode = findClosestNode(focalPoint);
        if (closestNode) {
          pendingCompensation = {
            nodeId: closestNode.id,
            oldPosition: { ...closestNode.position },
          };
        }
      }

      prevMode = newMode;
      prevZoom = zoom;
      onZoomChange(zoom);
    }
  });

  // Compensate viewport after layout changes
  $effect(() => {
    if (pendingCompensation && !isCompensating) {
      const { nodeId, oldPosition } = pendingCompensation;
      const focalNode = nodes.find(n => n.id === nodeId);

      if (focalNode) {
        // Calculate how much the node moved
        const deltaX = focalNode.position.x - oldPosition.x;
        const deltaY = focalNode.position.y - oldPosition.y;

        // Only compensate if there's actual movement
        if (deltaX !== 0 || deltaY !== 0) {
          const currentViewport = getViewport();

          // Set flag to prevent zoom effect from re-triggering
          isCompensating = true;

          // Adjust viewport to compensate (scaled by zoom)
          setViewport(
            {
              x: currentViewport.x - deltaX * currentViewport.zoom,
              y: currentViewport.y - deltaY * currentViewport.zoom,
              zoom: currentViewport.zoom,
            },
            { duration: 0 }
          );

          // Clear flag after viewport settles
          requestAnimationFrame(() => {
            isCompensating = false;
            setTransitionsEnabled(true);
          });
        } else {
          // No movement, just re-enable transitions
          setTransitionsEnabled(true);
        }

        pendingCompensation = null;
      }
    }
  });
</script>

<!-- This component renders nothing, it just tracks zoom -->
