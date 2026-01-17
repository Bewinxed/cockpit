/**
 * Automatic hierarchical layout using dagre
 * Positions nodes in a top-to-bottom flow graph
 */

import dagre from '@dagrejs/dagre';
import { Position, type Node, type Edge } from '@xyflow/svelte';

// Default node dimensions for layout calculations
const NODE_WIDTH = 320;

// Spacing configurations for different zoom modes
const COMPACT_CONFIG = {
  nodeHeightMin: 40,    // Minimum node height
  nodeHeightMax: 60,    // Max height in compact (abbreviated anyway)
  nodeSep: 30,          // Horizontal spacing
  rankSep: 20,          // Vertical spacing - tight for compact view
  charsPerLine: 50,     // Approximate chars per line
  lineHeight: 16,       // Line height in px
};

const EXPANDED_CONFIG = {
  nodeHeightMin: 120,   // Minimum node height (header + some content)
  nodeHeightMax: 500,   // Max height for very long messages
  nodeSep: 40,          // Horizontal spacing
  rankSep: 60,          // Vertical spacing - room for expanded content
  charsPerLine: 40,     // Chars per line (more conservative)
  lineHeight: 24,       // Line height in px (accounts for padding)
};

/**
 * Estimate node height based on content
 */
function estimateContentHeight(
  node: Node,
  config: typeof COMPACT_CONFIG | typeof EXPANDED_CONFIG
): number {
  const content = node.data?.content as string | undefined;
  if (!content || typeof content !== 'string') {
    return config.nodeHeightMin;
  }

  // Count actual newlines in content for better line estimation
  const newlineCount = (content.match(/\n/g) || []).length;
  // Estimate wrapped lines based on content length
  const wrappedLines = Math.ceil(content.length / config.charsPerLine);
  // Total lines is the max of newlines or wrapped estimate
  const totalLines = Math.max(newlineCount + 1, wrappedLines);

  // Base height includes: header (40px), padding (24px top+bottom), borders
  const baseHeight = 80;
  const contentHeight = totalLines * config.lineHeight;
  const estimatedHeight = baseHeight + contentHeight;

  // Clamp between min and max
  return Math.max(config.nodeHeightMin, Math.min(config.nodeHeightMax, estimatedHeight));
}

export type ZoomMode = 'compact' | 'expanded';

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
  /** Zoom mode affects spacing - 'compact' for zoomed out, 'expanded' for zoomed in */
  zoomMode?: ZoomMode;
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
  // Select config based on zoom mode
  const config = options.zoomMode === 'expanded' ? EXPANDED_CONFIG : COMPACT_CONFIG;

  const {
    direction = 'TB',
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
    ranker: 'tight-tree', // Use tight-tree for more compact layout
    // Default alignment (undefined) centers nodes within their rank
  });

  // Add nodes to dagre with content-based heights
  for (const node of nodes) {
    // Estimate height based on content, clamped to min/max for zoom mode
    const height = estimateContentHeight(node, config);
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
  return nodes.map(node => {
    const nodeWithPosition = g.node(node.id);
    const height = nodeHeights.get(node.id) || config.nodeHeightMin;

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
 * Align fork points (nodes that share the same source) and merge points (nodes that share the same target)
 * This ensures parallel branches line up at both the start and end of forks
 *
 * IMPORTANT: When moving a node, we must also move all its descendants to maintain branch integrity
 */
function alignForkAndMergePoints(nodes: Node[], edges: Edge[]): Node[] {
  // Build maps for fork/merge detection and parent-child relationships
  const sourceToTargets = new Map<string, string[]>(); // fork: one source -> multiple targets
  const targetToSources = new Map<string, string[]>(); // merge: multiple sources -> one target
  const nodeToChildren = new Map<string, string[]>(); // parent -> children (for moving descendants)

  for (const edge of edges) {
    // Track fork points (source -> targets)
    const targets = sourceToTargets.get(edge.source) || [];
    targets.push(edge.target);
    sourceToTargets.set(edge.source, targets);

    // Track merge points (target <- sources)
    const sources = targetToSources.get(edge.target) || [];
    sources.push(edge.source);
    targetToSources.set(edge.target, sources);

    // Track parent-child for descendant movement
    const children = nodeToChildren.get(edge.source) || [];
    children.push(edge.target);
    nodeToChildren.set(edge.source, children);
  }

  // Build a map of node ID to node for quick lookup
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Helper to get all descendants of a node (for moving entire branches)
  function getDescendants(nodeId: string, visited = new Set<string>()): string[] {
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
  // When moving a branch head, move all its descendants too
  for (const [_sourceId, targetIds] of sourceToTargets) {
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

  // Note: We only align FORK points (branch starts), not MERGE points (branch ends)
  // Aligning merge points would require either:
  // 1. Moving fork heads (breaks fork alignment)
  // 2. Adding spacer nodes (complex)
  // Instead, branches of different lengths naturally end at different Y positions,
  // and edges connect from wherever each branch ends to the merge node.
  // This is acceptable visually - the fork alignment is the important part.

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

  // Align fork and merge points so parallel branches line up at both ends
  layoutedNodes = alignForkAndMergePoints(layoutedNodes, edges);

  // Return edges with consistent animation/style
  const styledEdges = edges.map(edge => ({
    ...edge,
    // Use smoothstep for cleaner routing
    type: edge.type || 'smoothstep',
  }));

  return { nodes: layoutedNodes, edges: styledEdges };
}
