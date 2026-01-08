/**
 * Flow Types
 * 
 * Types for SvelteFlow rendering layer.
 * These are minimal types containing only what SvelteFlow needs for rendering.
 * Business data is stored separately in NodeStore.
 */

import type { Node } from '@xyflow/svelte';
import type { NodeType } from './content';

// ============================================================================
// Flow Node Data (Minimal for SvelteFlow)
// ============================================================================

/**
 * Minimal node data for SvelteFlow rendering
 * 
 * SvelteFlow only needs:
 * - id: for correlation with NodeStore
 * - type: for selecting the correct component
 * 
 * All business data (content, commit, snapshotRefs, etc.) 
 * is accessed via nodeStore.get(id) in components.
 * 
 * Note: Extends Record<string, unknown> to satisfy SvelteFlow's generic constraint
 */
export interface FlowNodeData extends Record<string, unknown> {
  /** Node ID - used to look up data in NodeStore */
  id: string;
  /** Node type - used for component routing (lowercase for SvelteFlow) */
  type: string;
}

/**
 * SvelteFlow Node with minimal data
 */
export type FlowNode = Node<FlowNodeData>;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a flow node from business data
 */
export function createFlowNode(
  id: string,
  type: NodeType,
  position: { x: number; y: number }
): FlowNode {
  return {
    id,
    type,
    position,
    data: { id, type }
  };
}

/**
 * Get the SvelteFlow node type string from NodeType
 */
export function getFlowNodeType(nodeType: NodeType): string {
  return nodeType;
}
