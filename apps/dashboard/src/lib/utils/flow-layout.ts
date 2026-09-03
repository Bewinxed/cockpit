/**
 * Automatic hierarchical layout using dagre
 * Positions nodes in a top-to-bottom flow graph
 */

import dagre from "@dagrejs/dagre";
import { type Edge, type Node, Position } from "@xyflow/svelte";
import {
  estimateContentHeight,
  getLayoutConfig,
  NODE_WIDTH,
} from "./flow-constants";
import type { LayoutOptions } from "./flow-types";

// Re-export types for convenience
export type { LayoutOptions, ZoomMode } from "./flow-types";

/**
 * Apply dagre layout to position nodes hierarchically
 *
 * @param nodes - Nodes with positions at (0,0)
 * @param edges - Edges connecting nodes
 * @param options - Layout configuration
 * @returns New nodes array with calculated positions
 */
export function layoutNodes(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): Node[] {
  // Select config based on zoom mode
  const config = getLayoutConfig(options.zoomMode ?? "compact");

  const {
    direction = "TB",
    nodeSep = config.nodeSep,
    rankSep = config.rankSep,
    nodeWidth = NODE_WIDTH,
  } = options;

  // Store calculated heights for position adjustment later
  const nodeHeights = new Map<string, number>();

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSep,
    ranksep: rankSep,
    ranker: "tight-tree", // Use tight-tree for more compact layout
  });

  // Add nodes to dagre with content-based heights
  for (const node of nodes) {
    const content = node.data?.content as string | undefined;
    const height = estimateContentHeight(content, config);
    nodeHeights.set(node.id, height);

    g.setNode(node.id, {
      width: nodeWidth,
      height,
    });
  }

  // Add edges to dagre
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run dagre layout algorithm
  dagre.layout(g);

  // Apply calculated positions to nodes
  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    const height = nodeHeights.get(node.id) || config.nodeHeightMin;

    // Set handle positions based on layout direction
    const isHorizontal = direction === "LR";

    return {
      ...node,
      position: {
        // Dagre returns center position, adjust to top-left for svelte-flow
        x: nodeWithPosition.x - nodeWidth / 2,
        y: nodeWithPosition.y - height / 2,
      },
      // Set handle positions for proper edge routing
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
    };
  });
}

/**
 * Align fork points (nodes that share the same source) and merge points
 * This ensures parallel branches line up at both the start and end of forks
 *
 * IMPORTANT: When moving a node, we must also move all its descendants to maintain branch integrity
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fork/merge alignment walks the graph in several coordinated passes; splitting it obscures the shared node/edge maps
function alignForkAndMergePoints(nodes: Node[], edges: Edge[]): Node[] {
  // Build maps for fork/merge detection and parent-child relationships
  const sourceToTargets = new Map<string, string[]>();
  const nodeToChildren = new Map<string, string[]>();

  for (const edge of edges) {
    // Track fork points (source -> targets)
    const targets = sourceToTargets.get(edge.source) || [];
    targets.push(edge.target);
    sourceToTargets.set(edge.source, targets);

    // Track parent-child for descendant movement
    const children = nodeToChildren.get(edge.source) || [];
    children.push(edge.target);
    nodeToChildren.set(edge.source, children);
  }

  // Build a map of node ID to node for quick lookup
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  // Helper to get all descendants of a node (for moving entire branches)
  function getDescendants(
    nodeId: string,
    visited = new Set<string>()
  ): string[] {
    const descendants: string[] = [];
    const children = nodeToChildren.get(nodeId) || [];
    for (const child of children) {
      if (!visited.has(child)) {
        visited.add(child);
        descendants.push(child);
        descendants.push(...getDescendants(child, visited));
      }
    }
    return descendants;
  }

  // Align FORK points (first nodes of parallel branches should be at same Y)
  for (const [, targetIds] of sourceToTargets) {
    if (targetIds.length > 1) {
      // This is a fork point - align all target nodes to the same Y (top edge)
      let maxY = 0;
      for (const targetId of targetIds) {
        const targetNode = nodeMap.get(targetId);
        if (targetNode) {
          maxY = Math.max(maxY, targetNode.position.y);
        }
      }

      // Move each target and ALL its descendants by the same delta
      for (const targetId of targetIds) {
        const targetNode = nodeMap.get(targetId);
        if (targetNode) {
          const delta = maxY - targetNode.position.y;
          if (delta !== 0) {
            // Move the branch head
            targetNode.position = { ...targetNode.position, y: maxY };

            // Move all descendants by the same delta
            const descendants = getDescendants(targetId);
            for (const descId of descendants) {
              const descNode = nodeMap.get(descId);
              if (descNode) {
                descNode.position = {
                  ...descNode.position,
                  y: descNode.position.y + delta,
                };
              }
            }
          }
        }
      }
    }
  }

  return nodes;
}

/**
 * Calculate layout and also create properly typed edges
 * Convenience function that returns both nodes and edges
 */
export function applyLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  let layoutedNodes = layoutNodes(nodes, edges, options);

  // Align fork and merge points so parallel branches line up
  layoutedNodes = alignForkAndMergePoints(layoutedNodes, edges);

  // Return edges with consistent animation/style
  const styledEdges = edges.map((edge) => ({
    ...edge,
    type: edge.type || "smoothstep",
  }));

  return { nodes: layoutedNodes, edges: styledEdges };
}
