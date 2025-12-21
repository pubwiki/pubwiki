/**
 * Node Components for Studio Graph
 * 
 * This module exports all node type components used in the studio graph.
 * Each node type extends a common base structure for consistent behavior.
 */

// Base components
export { default as BaseNode } from './BaseNode.svelte';

// Concrete node types
export { default as PromptNode } from './PromptNode.svelte';
export { default as InputNode } from './InputNode.svelte';
export { default as GeneratedNode } from './GeneratedNode.svelte';
export { default as VFSNode } from './VFSNode.svelte';

// Re-export types
export type { BaseNodeProps, NodeHeaderProps } from './types';

// Unified GraphNode that handles all standard text-based node types
export { default as GraphNode } from './GraphNode.svelte';
