/**
 * Studio Context
 * 
 * Provides dependency injection for studio components via Svelte context.
 * This decouples GraphNode from +page.svelte, allowing direct access to
 * shared state without passing callbacks through node data.
 */

import { getContext, setContext } from 'svelte';
import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, NodeRef, SnapshotEdge } from './types';

// ============================================================================
// Context Types
// ============================================================================

/**
 * Preview state for a node showing historical version or used state
 */
export interface PreviewState {
  /** Historical content (if different from current) */
  content?: string;
  /** Historical commit hash */
  commit?: string;
  /** Historical incoming edges (connections TO this node at time of snapshot) */
  incomingEdges?: SnapshotEdge[];
  /** Whether this node is simply used (referenced but not changed) */
  isUsed?: boolean;
}

/**
 * Studio context interface - provides access to shared state and operations
 */
export interface StudioContext {
  // State accessors (using getters for reactive access)
  readonly nodes: Node<StudioNodeData>[];
  readonly edges: Edge[];
  readonly editingNodeId: string | null;
  
  // State mutations
  setNodes: (nodes: Node<StudioNodeData>[]) => void;
  updateNode: (id: string, updater: (data: StudioNodeData) => StudioNodeData) => void;
  setEdges: (edges: Edge[]) => void;
  setEditingNodeId: (id: string | null) => void;
  
  // Textarea registry for focus control
  registerTextarea: (id: string, el: HTMLTextAreaElement) => void;
  unregisterTextarea: (id: string) => void;
  
  // Operations
  onGenerate: (inputNodeId: string) => Promise<void>;
  onRegenerate: (generatedNodeId: string) => Promise<void>;
  onRestore: (nodeId: string, snapshotRef: NodeRef) => void;
  saveVersionBeforeEdit: (nodeId: string) => Promise<void>;
  
  // Preview state (for historical version display)
  getPreviewState: (nodeId: string) => PreviewState | null;
}

// ============================================================================
// Context Key
// ============================================================================

const STUDIO_CONTEXT_KEY = Symbol('studio-context');

// ============================================================================
// Context Helpers
// ============================================================================

/**
 * Set the studio context (called in +page.svelte)
 */
export function setStudioContext(context: StudioContext): void {
  setContext(STUDIO_CONTEXT_KEY, context);
}

/**
 * Get the studio context (called in child components like GraphNode)
 */
export function getStudioContext(): StudioContext {
  const context = getContext<StudioContext>(STUDIO_CONTEXT_KEY);
  if (!context) {
    throw new Error('StudioContext not found. Make sure to call setStudioContext in parent component.');
  }
  return context;
}
