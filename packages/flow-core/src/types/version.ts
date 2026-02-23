/**
 * Version Control Types
 * 
 * Core type definitions for the version control system.
 * These types are designed to be node-type agnostic.
 */

import type { NodeContent, NodeType } from './content'

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
  /** Snapshot content */
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

/**
 * Base interface for versionable node data.
 * Any node type that supports version control should extend this interface.
 */
export interface Versionable {
  /** Unique node identifier */
  id: string
  /** Node type */
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
}

// ============================================================================
// Version Handler Registry
// ============================================================================

/**
 * Version handler for a specific node type.
 */
export interface VersionHandler<TData extends Versionable = Versionable> {
  /**
   * Extract version references from node data.
   */
  getVersionRefs?: (data: TData) => NodeRef[] | undefined
}

/**
 * Global registry for version handlers.
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
 */
export function getVersionHandler(nodeType: string): VersionHandler | undefined {
  return versionHandlerRegistry.get(nodeType.toUpperCase())
}

// ============================================================================
// Preview State
// ============================================================================

/**
 * Preview state for a node showing historical version or used state.
 */
export interface PreviewState {
  /** Historical content (if different from current) */
  content?: NodeContent
  /** Historical commit hash */
  commit?: string
  /** Historical incoming edges */
  incomingEdges?: SnapshotEdge[]
  /** Whether this node is simply used (referenced but not changed) */
  isUsed?: boolean
}

// ============================================================================
// Historical Tree Result
// ============================================================================

/**
 * Result of rebuilding historical dependency tree.
 */
export interface HistoricalTreeResult<TData = unknown> {
  /** Map of existing node IDs to their historical node data */
  nodeOverrides: Map<string, TData>
  /** Phantom nodes for deleted nodes */
  phantomNodes: Array<{
    id: string
    type: NodeType
    position: SnapshotPosition
    data: TData
  }>
  /** Historical edges to display */
  historicalEdges: Array<{
    id: string
    source: string
    target: string
    sourceHandle?: string | null
    targetHandle?: string | null
  }>
  /** IDs of nodes that are used but not changed */
  usedNodeIds: Set<string>
}
