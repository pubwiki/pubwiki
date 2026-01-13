/**
 * Studio Context
 * 
 * Provides dependency injection for studio components via Svelte context.
 * 
 * Version 2 - Layer Separation:
 * - Node business data is accessed via nodeStore (not through context)
 * - Context provides flow state (edges) and UI state (editing node)
 * - updateNode now updates via nodeStore
 */

import { getContext, setContext } from 'svelte';
import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '../types/flow';
import type { StudioNodeData, NodeContent } from '../types';
import type { NodeRef, SnapshotEdge } from '../version';

// ============================================================================
// Context Types
// ============================================================================

/**
 * Preview state for a node showing historical version or used state
 */
export interface PreviewState {
	/** Historical content (if different from current) */
	content?: NodeContent;
	/** Historical commit hash */
	commit?: string;
	/** Historical incoming edges (connections TO this node at time of snapshot) */
	incomingEdges?: SnapshotEdge[];
	/** Whether this node is simply used (referenced but not changed) */
	isUsed?: boolean;
}

/**
 * Studio context interface - provides access to shared state and operations
 * 
 * Note: Business data is accessed via nodeStore, not through this context.
 * This context provides:
 * - Flow state (nodes for rendering, edges)
 * - UI state (editing node)
 * - Operations that affect flow (not business data)
 */
export interface StudioContext {
	// Flow state accessors (rendering layer)
	readonly nodes: Node<FlowNodeData>[];
	readonly edges: Edge[];
	readonly editingNodeId: string | null;
	readonly editingNameNodeId: string | null;
	
	// Flow state mutations
	setNodes: (nodes: Node<FlowNodeData>[]) => void;
	updateNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void;
	setEdges: (edges: Edge[]) => void;
	updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
	setEditingNodeId: (id: string | null) => void;
	setEditingNameNodeId: (id: string | null) => void;
	
	// Business data mutations (delegates to nodeStore)
	updateNodeData: (id: string, updater: (data: StudioNodeData) => StudioNodeData) => void;
	
	// Textarea registry for focus control
	registerTextarea: (id: string, el: HTMLTextAreaElement) => void;
	unregisterTextarea: (id: string) => void;
	
	// Operations
	onRestore: (nodeId: string, snapshotRef: NodeRef) => void;
	
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

