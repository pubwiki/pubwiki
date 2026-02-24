/**
 * Flow Graph Core
 * 
 * Platform-independent core logic for flow graph operations.
 * Orchestrates node storage, version control, and validation
 * without any framework or browser dependencies.
 */

import type { Versionable, NodeRef, NodeSnapshot } from '../types/version'
import type { NodeType, NodeContent } from '../types/content'
import { restoreContent } from '../types/content'
import type { GraphEdge } from '../types/edge'
import type { INodeStore, ISnapshotStore, SaveSnapshotOptions } from '../interfaces/store'
import type { ICryptoProvider } from '../interfaces/crypto'
import { validateConnection, type ConnectionParams, type ValidationResult } from '../registry/connection'
import { computeContentHash, computeNodeCommit } from '../hash'
import type { CreateArtifactNode, ArtifactEdgeDescriptor, ArtifactNodeType } from '@pubwiki/api'
import { ImmutableGraph } from '../graph/immutable-graph'

// ============================================================================
// Options Types
// ============================================================================

/**
 * Options for creating a new node
 */
export interface CreateNodeOptions {
  /** Optional node ID (will generate UUID if not provided) */
  id?: string
  /** Optional node name */
  name?: string
  /** Optional initial content */
  content?: NodeContent
  /** Optional parent commit for version lineage */
  parent?: string | null
}

/**
 * Options for initializing FlowGraphCore
 */
export interface FlowGraphCoreOptions<T extends Versionable, C> {
  /** Node data store implementation */
  nodeStore: INodeStore<T>
  /** Snapshot store implementation */
  snapshotStore: ISnapshotStore<C>
  /** Crypto provider implementation */
  crypto: ICryptoProvider
  /** Function to create content for a node type */
  createContent: (type: NodeType, options?: CreateNodeOptions) => NodeContent
  /** Function to serialize content for snapshot storage */
  serializeContent: (content: NodeContent) => C
  /** Function to deserialize content from snapshot storage */
  deserializeContent: (type: NodeType, data: C) => NodeContent
}

// ============================================================================
// Flow Graph Core Class
// ============================================================================

/**
 * Core flow graph logic layer
 * 
 * Provides platform-independent operations for:
 * - Node CRUD operations with automatic versioning
 * - Connection validation
 * - Snapshot save/restore
 * 
 * @template T - Node data type (must extend Versionable)
 * @template C - Content serialization type for snapshots
 */
export class FlowGraphCore<T extends Versionable = Versionable, C = unknown> {
  private nodeStore: INodeStore<T>
  private snapshotStore: ISnapshotStore<C>
  private crypto: ICryptoProvider
  private createContent: (type: NodeType, options?: CreateNodeOptions) => NodeContent
  private serializeContent: (content: NodeContent) => C
  private deserializeContent: (type: NodeType, data: C) => NodeContent

  constructor(options: FlowGraphCoreOptions<T, C>) {
    this.nodeStore = options.nodeStore
    this.snapshotStore = options.snapshotStore
    this.crypto = options.crypto
    this.createContent = options.createContent
    this.serializeContent = options.serializeContent
    this.deserializeContent = options.deserializeContent
  }

  // ============================================================================
  // Node Operations
  // ============================================================================

  /**
   * Create a new node
   * 
   * @param type - Node type to create
   * @param options - Creation options
   * @returns The created node data
   */
  async createNode(type: NodeType, options: CreateNodeOptions = {}): Promise<T> {
    const id = options.id ?? this.crypto.randomUUID()
    const name = options.name ?? ''
    const parent = options.parent ?? null
    const content = options.content ?? this.createContent(type, options)

    // Compute content hash
    const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
    
    // Compute commit hash
    const commit = await computeNodeCommit(id, parent, contentHash, type)

    const nodeData = {
      id,
      type,
      name,
      commit,
      contentHash,
      parent,
      snapshotRefs: [],
      content,
    } as unknown as T

    this.nodeStore.set(id, nodeData)
    return nodeData
  }

  /**
   * Update node content
   * 
   * Updates the node's content and recomputes version hashes.
   * 
   * @param nodeId - Node ID to update
   * @param content - New content
   */
  async updateNodeContent(nodeId: string, content: NodeContent): Promise<void> {
    const node = this.nodeStore.get(nodeId)
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`)
    }

    // Compute new content hash
    const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])

    // If content didn't change, skip update
    if (contentHash === node.contentHash) {
      return
    }

    // Compute new commit hash (parent becomes current commit)
    const commit = await computeNodeCommit(nodeId, node.commit, contentHash, node.type)

    this.nodeStore.update(nodeId, (data) => ({
      ...data,
      content,
      contentHash,
      commit,
      parent: node.commit,
    } as T))
  }

  /**
   * Update node name
   */
  updateNodeName(nodeId: string, name: string): void {
    const node = this.nodeStore.get(nodeId)
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`)
    }

    this.nodeStore.update(nodeId, (data) => ({
      ...data,
      name,
    } as T))
  }

  /**
   * Delete a node
   */
  deleteNode(nodeId: string): void {
    this.nodeStore.delete(nodeId)
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: string): T | undefined {
    return this.nodeStore.get(nodeId)
  }

  /**
   * Get a node by name
   */
  getNodeByName(name: string): T | undefined {
    return this.nodeStore.getByName(name)
  }

  /**
   * Get all nodes
   */
  getAllNodes(): T[] {
    return this.nodeStore.getAll()
  }

  // ============================================================================
  // Connection Validation
  // ============================================================================

  /**
   * Validate a proposed connection
   * 
   * @param connection - Connection parameters
   * @param existingEdges - Current edges in the graph
   * @returns Validation result
   */
  validateConnection(
    connection: ConnectionParams,
    existingEdges: GraphEdge[]
  ): ValidationResult {
    return validateConnection(
      connection,
      (nodeId) => this.nodeStore.get(nodeId)?.type,
      existingEdges
    )
  }

  // ============================================================================
  // Version Control
  // ============================================================================

  /**
   * Save a snapshot of a node's current state
   * 
   * @param nodeId - Node to snapshot
   * @param options - Optional position and incoming edges
   * @returns Reference to the saved snapshot
   */
  async saveSnapshot(
    nodeId: string,
    options?: SaveSnapshotOptions
  ): Promise<NodeRef> {
    const node = this.nodeStore.get(nodeId)
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`)
    }

    const snapshot: NodeSnapshot<C> = {
      nodeId: node.id,
      commit: node.commit,
      type: node.type,
      name: node.name,
      content: this.serializeContent(node.content),
      timestamp: Date.now(),
      position: options?.position,
      incomingEdges: options?.incomingEdges,
    }

    await this.snapshotStore.save(snapshot)

    // Update node's snapshotRefs
    const ref: NodeRef = { id: nodeId, commit: node.commit }
    this.nodeStore.update(nodeId, (data) => ({
      ...data,
      snapshotRefs: [...data.snapshotRefs, ref],
    } as T))

    return ref
  }

  /**
   * Get a historical snapshot
   * 
   * @param nodeId - Node ID
   * @param commit - Commit hash
   * @returns The snapshot if found
   */
  async getSnapshot(nodeId: string, commit: string): Promise<NodeSnapshot<C> | undefined> {
    return this.snapshotStore.get(nodeId, commit)
  }

  /**
   * Restore a node to a historical snapshot
   * 
   * @param nodeId - Node to restore
   * @param ref - Reference to the snapshot to restore
   */
  async restoreSnapshot(nodeId: string, ref: NodeRef): Promise<void> {
    const snapshot = await this.snapshotStore.get(nodeId, ref.commit)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${nodeId}@${ref.commit}`)
    }

    const content = this.deserializeContent(snapshot.type, snapshot.content)
    
    // Create new version with restored content
    // Parent is current commit, not the snapshot's parent
    const currentNode = this.nodeStore.get(nodeId)
    const currentCommit = currentNode?.commit ?? null

    const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
    const commit = await computeNodeCommit(nodeId, currentCommit, contentHash, snapshot.type)

    this.nodeStore.update(nodeId, (data) => ({
      ...data,
      content,
      contentHash,
      commit,
      parent: currentCommit,
      name: snapshot.name,
    } as T))
  }

  /**
   * Get history of snapshots for a node
   * 
   * @param nodeId - Node ID
   * @returns List of snapshots sorted by timestamp
   */
  async getHistory(nodeId: string): Promise<NodeSnapshot<C>[]> {
    return this.snapshotStore.list(nodeId)
  }

  /**
   * Check if a snapshot exists
   */
  async hasSnapshot(nodeId: string, commit: string): Promise<boolean> {
    return this.snapshotStore.has(nodeId, commit)
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if a node name is available
   * 
   * @param name - Name to check
   * @param excludeNodeId - Optional node to exclude (for renaming)
   */
  isNameAvailable(name: string, excludeNodeId?: string): boolean {
    return !this.nodeStore.isNameTaken(name, excludeNodeId)
  }

  /**
   * Generate a new UUID
   */
  generateId(): string {
    return this.crypto.randomUUID()
  }

  /**
   * Compute content hash for arbitrary content
   */
  async computeHash(content: NodeContent): Promise<string> {
    return computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
  }

  // ============================================================================
  // Conversion Methods
  // ============================================================================

  /**
   * Export current graph state as ImmutableGraph for validation
   * 
   * @param edges - Current edges (managed externally by UI)
   * @param getPosition - Optional function to get node positions
   * @returns ImmutableGraph for validation
   */
  toImmutableGraph(
    edges: GraphEdge[],
    getPosition?: (nodeId: string) => { x: number; y: number } | undefined
  ): ImmutableGraph {
    const nodes: CreateArtifactNode[] = this.getAllNodes().map(node => ({
      nodeId: node.id,
      commit: node.commit,
      type: node.type as ArtifactNodeType,
      name: node.name || undefined,
      contentHash: node.contentHash,
      content: node.content.toJSON() as CreateArtifactNode['content'],
      parent: node.parent ?? undefined,
      position: getPosition?.(node.id),
    }));

    const graphEdges: ArtifactEdgeDescriptor[] = edges.map(e => ({
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? undefined,
      targetHandle: e.targetHandle ?? undefined,
    }));

    return ImmutableGraph.fromArrays(nodes, graphEdges);
  }

  /**
   * Create a new FlowGraphCore instance from an ImmutableGraph
   * 
   * @param graph - ImmutableGraph to load from
   * @param options - FlowGraphCore options (stores, crypto, etc.)
   * @returns New FlowGraphCore instance with loaded nodes
   */
  static fromImmutableGraph<T extends Versionable, C>(
    graph: ImmutableGraph,
    options: FlowGraphCoreOptions<T, C>
  ): FlowGraphCore<T, C> {
    const core = new FlowGraphCore<T, C>(options);
    
    for (const node of graph.nodes) {
      const content = restoreContent(node.type as NodeType, node.content);
      const nodeData = {
        id: node.nodeId,
        type: node.type,
        name: node.name ?? '',
        commit: node.commit,
        contentHash: node.contentHash,
        parent: node.parent ?? null,
        snapshotRefs: [],
        content,
      } as unknown as T;
      
      core.nodeStore.set(node.nodeId, nodeData);
    }
    
    return core;
  }
}
