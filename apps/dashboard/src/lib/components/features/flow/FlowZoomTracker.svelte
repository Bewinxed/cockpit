<script lang="ts">
  import { type Node, useStore, useSvelteFlow } from "@xyflow/svelte";
  import {
    NODE_CENTER_X,
    ZOOM_THRESHOLD_LAYOUT,
  } from "$lib/utils/flow-constants";
  import type {
    PendingCompensation,
    Point,
    ZoomMode,
  } from "$lib/utils/flow-types";

  interface Props {
    nodes: Node[];
    onTransitionsDisabled?: (disabled: boolean) => void;
    onZoomChange: (zoom: number) => void;
  }

  let { onZoomChange, onTransitionsDisabled, nodes }: Props = $props();

  // Get viewport and flow utilities
  const { viewport } = $derived(useStore());
  const { screenToFlowPosition, setViewport, getViewport } = useSvelteFlow();
  const zoom = $derived(viewport.zoom);

  // Track previous zoom to detect threshold crossings
  let prevZoom = $state<number | null>(null);
  let prevMode = $state<ZoomMode | null>(null);
  let isCompensating = $state(false);
  let pendingCompensation = $state<PendingCompensation | null>(null);

  /**
   * Check if a number is valid (not NaN, not Infinity)
   */
  function isValidNumber(n: unknown): n is number {
    return typeof n === "number" && !isNaN(n) && isFinite(n);
  }

  /**
   * Check if a point has valid coordinates
   */
  function isValidPoint(p: Point | null | undefined): p is Point {
    return (
      p !== null && p !== undefined && isValidNumber(p.x) && isValidNumber(p.y)
    );
  }

  /**
   * Find the node closest to a point
   */
  function findClosestNode(point: Point): Node | null {
    if (nodes.length === 0 || !isValidPoint(point)) {
      return null;
    }

    let closest: Node | null = null;
    let minDist = Number.POSITIVE_INFINITY;

    for (const node of nodes) {
      // Skip nodes with invalid positions
      if (!(isValidNumber(node.position.x) && isValidNumber(node.position.y))) {
        continue;
      }

      const nodeCenterX = node.position.x + NODE_CENTER_X;
      const nodeCenterY = node.position.y + 20;
      const dist = Math.hypot(point.x - nodeCenterX, point.y - nodeCenterY);

      if (dist < minDist) {
        minDist = dist;
        closest = node;
      }
    }

    return closest;
  }

  /**
   * Control transitions via callback to parent
   * This replaces direct DOM manipulation
   */
  function setTransitionsEnabled(enabled: boolean) {
    onTransitionsDisabled?.(!enabled);
  }

  // Notify parent when zoom changes, detect threshold crossings
  $effect(() => {
    // Guard against invalid zoom values
    if (!isValidNumber(zoom) || isCompensating) {
      return;
    }

    const newMode: ZoomMode =
      zoom >= ZOOM_THRESHOLD_LAYOUT ? "expanded" : "compact";

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

        try {
          const focalPoint = screenToFlowPosition(viewportCenterScreen);

          // Only proceed if focalPoint is valid
          if (isValidPoint(focalPoint)) {
            // Find the node closest to the focal point and record its OLD position
            const closestNode = findClosestNode(focalPoint);
            if (
              closestNode &&
              isValidNumber(closestNode.position.x) &&
              isValidNumber(closestNode.position.y)
            ) {
              pendingCompensation = {
                nodeId: closestNode.id,
                oldPosition: { ...closestNode.position },
              };
            }
          }
        } catch {
          // screenToFlowPosition may throw before viewport is ready
          // Just continue without compensation
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
      const focalNode = nodes.find((n) => n.id === nodeId);

      if (
        focalNode &&
        isValidNumber(focalNode.position.x) &&
        isValidNumber(focalNode.position.y)
      ) {
        // Calculate how much the node moved
        const deltaX = focalNode.position.x - oldPosition.x;
        const deltaY = focalNode.position.y - oldPosition.y;

        // Only compensate if there's actual movement and deltas are valid
        if (
          (deltaX !== 0 || deltaY !== 0) &&
          isValidNumber(deltaX) &&
          isValidNumber(deltaY)
        ) {
          try {
            const currentViewport = getViewport();

            // Validate viewport values before using
            if (
              isValidNumber(currentViewport.x) &&
              isValidNumber(currentViewport.y) &&
              isValidNumber(currentViewport.zoom) &&
              currentViewport.zoom > 0
            ) {
              // Set flag to prevent zoom effect from re-triggering
              isCompensating = true;

              const newX = currentViewport.x - deltaX * currentViewport.zoom;
              const newY = currentViewport.y - deltaY * currentViewport.zoom;

              // Only setViewport if new values are valid
              if (isValidNumber(newX) && isValidNumber(newY)) {
                setViewport(
                  {
                    x: newX,
                    y: newY,
                    zoom: currentViewport.zoom,
                  },
                  { duration: 0 }
                );
              }

              // Clear flag after viewport settles
              requestAnimationFrame(() => {
                isCompensating = false;
                setTransitionsEnabled(true);
              });
            } else {
              // Invalid viewport, just re-enable transitions
              setTransitionsEnabled(true);
            }
          } catch {
            // getViewport/setViewport may throw before ready
            setTransitionsEnabled(true);
          }
        } else {
          // No movement, just re-enable transitions
          setTransitionsEnabled(true);
        }

        pendingCompensation = null;
      } else if (pendingCompensation) {
        // Node not found or invalid, clear pending and re-enable transitions
        pendingCompensation = null;
        setTransitionsEnabled(true);
      }
    }
  });
</script>

<!-- This component renders nothing, it just tracks zoom -->
