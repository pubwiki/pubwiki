/**
 * Version Control Types
 * 
 * Core type definitions for the version control system.
 * These types are designed to be node-type agnostic.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Reference to a node at a specific version
 */
export interface NodeRef {
	/** Node ID */
	id: string
	/** Commit hash at time of reference */
	commit: string
}

/**
 * Simplified edge info for snapshot storage
 * Only stores what's needed to restore connections
 */
export interface SnapshotEdge {
	/** Source node ID */
	source: string
	/** Source handle ID (if any) */
	sourceHandle?: string | null
	/** Target handle ID (if any) */
	targetHandle?: string | null
}

/**
 * Node position at time of snapshot
 */
export interface SnapshotPosition {
	x: number
	y: number
}

/**
 * Snapshot stored in global store.
 * 
 * Note: `content` can be either:
 * - Direct data (e.g., text content for prompt/input nodes)
 * - A "recipe" to restore data (e.g., git branch + commit for VFS nodes)
 * 
 * The interpretation of `content` is handled by the node type's VersionHandler.
 */
export interface NodeSnapshot<T = unknown> {
	/** Node ID this snapshot belongs to */
	nodeId: string
	/** Commit hash (content hash) */
	commit: string
	/** Node type at time of snapshot */
	type: NodeType
	/** Node name at time of snapshot */
	name: string
	/** 
	 * Snapshot content - can be direct data or a recipe to restore data.
	 * Interpretation depends on node type's VersionHandler.
	 */
	content: T
	/** Timestamp when snapshot was created */
	timestamp: number
	/** Incoming edges at time of snapshot (connections TO this node) */
	incomingEdges?: SnapshotEdge[]
	/** Node position at time of snapshot */
	position?: SnapshotPosition
}

// ============================================================================
// Versionable Interface
// ============================================================================

import type { NodeContent, NodeType } from '../types/content'

/**
 * Base interface for versionable node data.
 * Any node type that supports version control should extend this interface.
 * 
 * Content must implement NodeContent interface for polymorphic operations:
 * - content.serialize() for commit hash computation
 * - content.clone() for snapshot creation
 * - content.getText() for UI display
 */
export interface Versionable {
	/** Unique node identifier */
	id: string
	/** Node type (e.g., 'INPUT', 'PROMPT', 'GENERATED') */
	type: NodeType
	/** User-defined node name */
	name: string
	/** Current commit hash = computeNodeCommit(nodeId, parent, contentHash, type) */
	commit: string
	/** Content hash = SHA256(JSON.stringify(content))[:16] */
	contentHash: string
	/** Parent commit for version lineage (null for root versions) */
	parent: string | null
	/** References to historical snapshots (local only) */
	snapshotRefs: NodeRef[]
	/** Node content - implements NodeContent interface */
	content: NodeContent
	/** Index signature for xyflow compatibility */
	[key: string]: unknown
}

// ============================================================================
// Version Handler Registry
// ============================================================================

/**
 * Version handler for a specific node type.
 * 
 * After the content-type refactoring:
 * - Content implements NodeContent interface with clone()/serialize()
 * - No custom createSnapshotContent needed - use content.clone()
 * - No custom getContentForHash needed - use content.serialize()
 * 
 * Custom handlers are only needed for:
 * - getVersionRefs: Extract version references from node data (e.g., GeneratedNode)
 */
export interface VersionHandler<TData extends Versionable = Versionable> {
	/**
	 * Extract version references from node data.
	 * Return undefined if this node type doesn't hold version references.
	 * Return NodeRef[] if it references specific versions of other nodes.
	 */
	getVersionRefs?: (data: TData) => NodeRef[] | undefined
}

/**
 * Global registry for version handlers.
 * Node types register their handlers here.
 */
export const versionHandlerRegistry = new Map<string, VersionHandler>()

/**
 * Register a version handler for a node type.
 */
export function registerVersionHandler<TData extends Versionable>(
	nodeType: string,
	handler: VersionHandler<TData>
): void {
	versionHandlerRegistry.set(nodeType.toUpperCase(), handler as VersionHandler)
}

/**
 * Get version handler for a node type.
 * Returns undefined if no handler is registered.
 */
export function getVersionHandler(nodeType: string): VersionHandler | undefined {
	return versionHandlerRegistry.get(nodeType.toUpperCase())
}

// ============================================================================
// Preview State
// ============================================================================

/**
 * Preview state for a node showing historical version or used state.
 * Used by UI components to display version preview information.
 */
export interface PreviewState {
	/** Historical content (if different from current) */
	content?: NodeContent
	/** Historical commit hash */
	commit?: string
	/** Historical incoming edges (connections TO this node at time of snapshot) */
	incomingEdges?: SnapshotEdge[]
	/** Whether this node is simply used (referenced but not changed) */
	isUsed?: boolean
}

// ============================================================================
// Historical Tree Result
// ============================================================================

/**
 * Result of rebuilding historical dependency tree.
 * Contains all information needed to display version preview in UI.
 */
export interface HistoricalTreeResult<TData = unknown> {
	/** 
	 * Map of existing node IDs to their historical node data.
	 * These nodes exist in the current graph but need to display historical content.
	 */
	nodeOverrides: Map<string, TData>
	/** 
	 * Phantom nodes for deleted nodes that need to be temporarily displayed.
	 * These are full Node objects that can be merged into the nodes array.
	 */
	phantomNodes: Array<{
		id: string
		type: NodeType
		position: SnapshotPosition
		data: TData
	}>
	/** 
	 * Historical edges to display.
	 * These should replace/augment current edges for the involved nodes.
	 */
	historicalEdges: Array<{
		id: string
		source: string
		target: string
		sourceHandle?: string | null
		targetHandle?: string | null
	}>
	/**
	 * IDs of nodes that are referenced by the generated node (used but not changed).
	 * These nodes exist and their content matches the historical version.
	 */
	usedNodeIds: Set<string>
}
