/**
 * Node Layout Utilities
 * 
 * Functions for positioning and laying out nodes in the Studio graph.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData } from '../types';

// ============================================================================
// Layout Constants
// ============================================================================

/** Default node width when not yet measured */
export const DEFAULT_NODE_WIDTH = 320;

/** Default node height when not yet measured */
export const DEFAULT_NODE_HEIGHT = 180;

/** Horizontal gap between adjacent nodes */
export const HORIZONTAL_GAP = 100;

/** Vertical gap between stacked nodes */
export const VERTICAL_GAP = 30;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the actual dimensions of a node, using measured values if available
 */
export function getNodeDimensions(node: Node): { width: number; height: number } {
	return {
		width: node.measured?.width ?? node.width ?? DEFAULT_NODE_WIDTH,
		height: node.measured?.height ?? node.height ?? DEFAULT_NODE_HEIGHT
	};
}

/**
 * Get the right edge X position of a node
 */
function getNodeRightEdge(node: Node): number {
	return node.position.x + (node.measured?.width ?? DEFAULT_NODE_WIDTH);
}

// ============================================================================
// Layout Functions
// ============================================================================

/**
 * Position new nodes relative to their connected source nodes.
 * This is used for generation flow where we add input -> generated nodes.
 * 
 * @param newNodeIds - IDs of the newly added nodes that need positioning
 * @param allNodes - All nodes in the graph (including new nodes)
 * @param allEdges - All edges in the graph
 * @returns Updated nodes array with new nodes positioned
 */
export function positionNewNodesFromSources(
	newNodeIds: string[],
	allNodes: Node<StudioNodeData>[],
	allEdges: Edge[]
): Node<StudioNodeData>[] {
	const newNodeIdSet = new Set(newNodeIds);

	return allNodes.map(node => {
		if (!newNodeIdSet.has(node.id)) {
			return node;
		}

		// Find incoming edges to this new node
		const incomingEdges = allEdges.filter(e => e.target === node.id);
		if (incomingEdges.length === 0) {
			// No sources, position based on existing nodes
			const existingNodes = allNodes.filter(n => !newNodeIdSet.has(n.id));
			if (existingNodes.length > 0) {
				// Position to the right of rightmost existing node
				const rightmostNode = existingNodes.reduce((max, n) => {
					return getNodeRightEdge(n) > getNodeRightEdge(max) ? n : max;
				});
				return {
					...node,
					position: {
						x: getNodeRightEdge(rightmostNode) + HORIZONTAL_GAP,
						y: rightmostNode.position.y
					}
				};
			}
			return node;
		}

		// Get source nodes
		const sourceNodes = incomingEdges
			.map(e => allNodes.find(n => n.id === e.source))
			.filter((n): n is Node<StudioNodeData> => n !== undefined);

		if (sourceNodes.length === 0) {
			return node;
		}

		// Calculate average Y position of sources and position to their right
		const avgY = sourceNodes.reduce((sum, n) => sum + n.position.y, 0) / sourceNodes.length;
		const rightmostSource = sourceNodes.reduce((max, n) => {
			return getNodeRightEdge(n) > getNodeRightEdge(max) ? n : max;
		});

		return {
			...node,
			position: {
				x: getNodeRightEdge(rightmostSource) + HORIZONTAL_GAP,
				y: avgY + (newNodeIds.indexOf(node.id) * VERTICAL_GAP)
			}
		};
	});
}
