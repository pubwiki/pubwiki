/**
 * Storage Abstraction Interfaces
 * 
 * Platform-independent interfaces for node data storage and snapshot persistence.
 * These abstractions allow flow-core to work with different storage backends:
 * - Svelte reactive stores (Studio)
 * - Plain Map (Node.js/testing)
 * - IndexedDB (browser persistence)
 */

import type { Versionable, NodeSnapshot, SnapshotEdge, SnapshotPosition } from '../types/version'

// ============================================================================
// Node Store Interface
// ============================================================================

/**
 * In-memory node data store abstraction.
 * 
 * Provides CRUD operations for node data with optional reactivity.
 * Implementations can be:
 * - Plain Map (no reactivity, for testing/Node.js)
 * - SvelteMap wrapper (fine-grained reactivity)
 * 
 * @template T - Node data type (must extend Versionable)
 */
export interface INodeStore<T extends Versionable = Versionable> {
  /**
   * Get node data by ID
   */
  get(nodeId: string): T | undefined

  /**
   * Get all nodes
   */
  getAll(): T[]

  /**
   * Get all node IDs
   */
  getAllIds(): string[]

  /**
   * Check if a node exists
   */
  has(nodeId: string): boolean

  /**
   * Set node data (creates or updates)
   */
  set(nodeId: string, data: T): void

  /**
   * Update node data with an updater function
   */
  update(nodeId: string, updater: (data: T) => T): void

  /**
   * Delete a node
   */
  delete(nodeId: string): void

  /**
   * Get node by name
   */
  getByName(name: string): T | undefined

  /**
   * Get node ID by name
   */
  getIdByName(name: string): string | undefined

  /**
   * Check if a name is taken
   * 
   * @param name - Name to check
   * @param excludeNodeId - Optional node to exclude (for renaming)
   */
  isNameTaken(name: string, excludeNodeId?: string): boolean
}

// ============================================================================
// Snapshot Store Interface
// ============================================================================

/**
 * Options for saving a snapshot
 */
export interface SaveSnapshotOptions {
  /** Node position at time of snapshot */
  position?: SnapshotPosition
  /** Incoming edges at time of snapshot */
  incomingEdges?: SnapshotEdge[]
}

/**
 * Persistent snapshot storage abstraction.
 * 
 * Handles historical version persistence.
 * Implementations can be:
 * - IndexedDB (browser)
 * - File system (Node.js)
 * - In-memory Map (testing)
 * 
 * @template T - Content type stored in snapshots
 */
export interface ISnapshotStore<T = unknown> {
  /**
   * Save a snapshot
   */
  save(snapshot: NodeSnapshot<T>): Promise<void>

  /**
   * Get a specific snapshot by node ID and commit
   */
  get(nodeId: string, commit: string): Promise<NodeSnapshot<T> | undefined>

  /**
   * List all snapshots for a node, sorted by timestamp
   */
  list(nodeId: string): Promise<NodeSnapshot<T>[]>

  /**
   * Check if a snapshot exists
   */
  has(nodeId: string, commit: string): Promise<boolean>

  /**
   * Delete a specific snapshot
   */
  delete(nodeId: string, commit: string): Promise<void>

  /**
   * Delete all snapshots for a node
   */
  deleteAll(nodeId: string): Promise<void>
}

// ============================================================================
// Combined Store Interface
// ============================================================================

/**
 * Combined storage interface for flow graph operations.
 * 
 * Bundles node store and snapshot store together for convenience.
 */
export interface IFlowStorage<T extends Versionable = Versionable, C = unknown> {
  /** In-memory node data store */
  nodes: INodeStore<T>
  /** Persistent snapshot storage */
  snapshots: ISnapshotStore<C>
}
