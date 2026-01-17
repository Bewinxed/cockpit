/**
 * Automatic hierarchical layout using dagre
 * Positions nodes in a top-to-bottom flow graph
 */

import dagre from '@dagrejs/dagre';
import { Position, type Node, type Edge } from '@xyflow/svelte';

// Default node dimensions for layout calculations
const NODE_WIDTH = 320;
const NODE_HEIGHT_MIN = 140;

// Spacing between nodes
const NODE_SEP = 80;   // Horizontal spacing
const RANK_SEP = 180;  // Vertical spacing (between rows)

export interface LayoutOptions {
  /** Layout direction: TB (top-bottom) or LR (left-right) */
  direction?: 'TB' | 'LR';
  /** Horizontal spacing between nodes */
  nodeSep?: number;
  /** Vertical spacing between ranks (rows) */
  rankSep?: number;
  /** Default node width */
  nodeWidth?: number;
  /** Default node height */
  nodeHeightMin?: number;
}

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
  const {
    direction = 'TB',
    nodeSep = NODE_SEP,
    rankSep = RANK_SEP,
    nodeWidth = NODE_WIDTH,
    nodeHeightMin = NODE_HEIGHT_MIN,
  } = options;

  // Create dagre graph
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: nodeSep,
    ranksep: rankSep,
  });

  // Add nodes to dagre
  for (const node of nodes) {
    // Get node height from data if provided, otherwise use minimum
    const height = (node.data?.height as number) || nodeHeightMin;
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
  return nodes.map(node => {
    const nodeWithPosition = g.node(node.id);
    const height = (node.data?.height as number) || nodeHeightMin;

    // Set handle positions based on layout direction
    const isHorizontal = direction === 'LR';

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
 * Calculate layout and also create properly typed edges
 * Convenience function that returns both nodes and edges
 */
export function applyLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions = {}
): { nodes: Node[]; edges: Edge[] } {
  const layoutedNodes = layoutNodes(nodes, edges, options);

  // Return edges with consistent animation/style
  const styledEdges = edges.map(edge => ({
    ...edge,
    // Use smoothstep for cleaner routing
    type: edge.type || 'smoothstep',
  }));

  return { nodes: layoutedNodes, edges: styledEdges };
}
