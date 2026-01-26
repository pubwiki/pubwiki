/**
 * Version DAG - Immutable state versioning
 * 
 * Manages a DAG of state references where each operation creates a new ref.
 * Supports checkout to any ref and implicit branching.
 * 
 * Uses Dexie.js (IndexedDB) for persistence via VersionStore.
 */

import type { Quad } from '@rdfjs/types'
import type { Ref, RefNode, Checkpoint, CheckpointOptions, Operation } from '../types.js'
import { ROOT_REF, toSyncOperation } from '../types.js'
import { generateRef } from '@pubwiki/rdfsync'
import { fromRdfQuad, toRdfQuad } from '@pubwiki/rdfsync/convert'
import { VersionStore, VersionDatabase } from './store.js'

/**
 * Version DAG Manager
 * 
 * Manages the immutable state DAG and checkpoints using Dexie.js storage
 */
export class VersionDAG {
  private store: VersionStore
  private _currentRef: Ref = ROOT_REF
  private _isOpen = false

  constructor(store: VersionStore) {
    this.store = store
  }

  get currentRef(): Ref {
    return this._currentRef
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Get the underlying VersionStore
   */
  getStore(): VersionStore {
    return this.store
  }

  /**
   * Open the version DAG
   */
  async open(): Promise<void> {
    if (this._isOpen) return
    
    this._isOpen = true
    
    // Restore current ref
    const savedRef = await this.store.getHead()
    if (savedRef) {
      this._currentRef = savedRef
    }
  }

  /**
   * Close the version DAG
   */
  async close(): Promise<void> {
    if (!this._isOpen) return
    await this.store.close()
    this._isOpen = false
  }

  private ensureOpen(): void {
    if (!this._isOpen) {
      throw new Error('VersionDAG not open')
    }
  }

  // ============ Ref Node Operations ============

  /**
   * Record a new operation, creating a new ref
   * Uses blockchain-style deterministic ref generation:
   * ref = SHA256(parentRef + canonical(operation))[0:16]
   * 
   * @returns The new ref
   */
  async recordOperation(operation: Operation): Promise<Ref> {
    this.ensureOpen()
    
    // Generate deterministic ref using chain hash
    const ref = await generateRef(this._currentRef, toSyncOperation(operation))
    
    const node: RefNode = {
      ref,
      parent: this._currentRef,
      operation,
      timestamp: Date.now(),
    }

    // Save the node
    await this.store.saveNode(node)

    // Update children index of parent
    await this.store.addChild(this._currentRef, ref)

    // Update current ref
    this._currentRef = ref
    await this.store.setHead(ref)

    return ref
  }

  /**
   * Get a ref node
   */
  async getNode(ref: Ref): Promise<RefNode | null> {
    if (ref === ROOT_REF) return null
    this.ensureOpen()
    return this.store.getNode(ref)
  }

  /**
   * Get children of a ref
   */
  async getChildren(ref: Ref): Promise<Ref[]> {
    this.ensureOpen()
    return this.store.getChildren(ref)
  }

  /**
   * Delete a ref node and remove it from parent's children
   * Used for transaction rollback
   */
  async deleteRef(ref: Ref): Promise<void> {
    if (ref === ROOT_REF) return
    
    this.ensureOpen()
    const node = await this.store.getNode(ref)
    if (!node) return

    // Remove from parent's children
    if (node.parent) {
      await this.store.removeChild(node.parent, ref)
    }

    // Delete the node
    await this.store.deleteNode(ref)
  }

  /**
   * Get the path from a ref to root
   * @returns Array of refs from the given ref to root (inclusive)
   */
  async getPathToRoot(ref: Ref): Promise<Ref[]> {
    this.ensureOpen()
    const path: Ref[] = [ref]
    let current = ref

    while (current !== ROOT_REF) {
      const node = await this.store.getNode(current)
      if (!node || !node.parent) break
      path.push(node.parent)
      current = node.parent
    }

    return path
  }

  /**
   * Get operation history from current ref to root
   * @param limit Maximum number of entries to return
   */
  async log(limit?: number): Promise<RefNode[]> {
    this.ensureOpen()
    const nodes: RefNode[] = []
    let current = this._currentRef

    while (current !== ROOT_REF) {
      const node = await this.store.getNode(current)
      if (!node) break
      nodes.push(node)
      if (limit && nodes.length >= limit) break
      current = node.parent!
    }

    return nodes
  }

  /**
   * Get operations from baseRef to targetRef (exclusive baseRef, inclusive targetRef)
   * Returns nodes in chronological order (oldest first)
   * Used for syncing operations to cloud
   */
  async getOperationsBetween(baseRef: Ref, targetRef: Ref): Promise<RefNode[]> {
    this.ensureOpen()
    
    // Early return if same ref
    if (baseRef === targetRef) {
      return []
    }

    // Walk from targetRef towards root, stop when we hit baseRef
    const nodes: RefNode[] = []
    let current = targetRef

    while (current !== ROOT_REF) {
      // Check if we've reached baseRef
      if (current === baseRef) {
        // Found baseRef, return collected nodes in chronological order
        return nodes.reverse()
      }

      const node = await this.store.getNode(current)
      if (!node) break
      
      nodes.push(node)
      current = node.parent!
    }

    // If we get here, baseRef was not found in the path
    // Return all nodes from root to targetRef (chronological order)
    return nodes.reverse()
  }

  // ============ Checkout ============

  /**
   * Set the current ref (used during checkout)
   */
  async setCurrentRef(ref: Ref): Promise<void> {
    this.ensureOpen()
    this._currentRef = ref
    await this.store.setHead(ref)
  }

  // ============ Checkpoint Operations ============

  /**
   * Create a checkpoint at the current ref
   * @param quads The current quad data to save
   * @param options Checkpoint options including title and description
   * @returns The checkpoint (including id and ref)
   */
  async createCheckpoint(quads: Quad[], options: CheckpointOptions): Promise<Checkpoint> {
    this.ensureOpen()
    const ref = this._currentRef
    const id = options.id ?? crypto.randomUUID()
    
    // Save checkpoint metadata
    const checkpoint: Checkpoint = {
      id,
      ref,
      title: options.title,
      description: options.description,
      timestamp: Date.now(),
      quadCount: quads.length,
    }
    await this.store.saveCheckpoint(checkpoint)

    // Save checkpoint data (convert RDF.js Quads to simple Quads)
    const data = quads.map(fromRdfQuad)
    await this.store.saveCheckpointData(ref, data)

    return checkpoint
  }

  /**
   * Get checkpoint metadata by id
   */
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    this.ensureOpen()
    return this.store.getCheckpoint(id)
  }

  /**
   * Load checkpoint data for a ref
   */
  async loadCheckpointData(ref: Ref): Promise<Quad[] | null> {
    this.ensureOpen()
    const data = await this.store.getCheckpointData(ref)
    if (data === null) return null
    return data.map(toRdfQuad)
  }

  /**
   * Find the nearest checkpoint on the path from ref to root
   * @returns The checkpoint ref and the path from checkpoint to target
   */
  async findNearestCheckpoint(targetRef: Ref): Promise<{ checkpointRef: Ref; pathFromCheckpoint: Ref[] } | null> {
    this.ensureOpen()
    const path = await this.getPathToRoot(targetRef)
    
    // Check each ref in path for a checkpoint
    for (let i = 0; i < path.length; i++) {
      const ref = path[i]
      
      // Root always has implicit empty checkpoint
      if (ref === ROOT_REF) {
        return {
          checkpointRef: ROOT_REF,
          pathFromCheckpoint: path.slice(0, i).reverse(),
        }
      }
      
      const hasCheckpoint = await this.store.hasCheckpointForRef(ref)
      if (hasCheckpoint) {
        return {
          checkpointRef: ref,
          pathFromCheckpoint: path.slice(0, i).reverse(),
        }
      }
    }

    // Fallback to root
    return {
      checkpointRef: ROOT_REF,
      pathFromCheckpoint: path.slice(0, -1).reverse(),
    }
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    this.ensureOpen()
    return this.store.listCheckpoints()
  }

  /**
   * Delete a checkpoint by id
   * Note: This only deletes the checkpoint metadata, not the checkpoint data or underlying operations
   * @param id - The checkpoint id
   * @param ref - The ref to delete checkpoint data for (optional, will delete data if provided)
   */
  async deleteCheckpoint(id: string, ref?: Ref): Promise<void> {
    this.ensureOpen()
    await this.store.deleteCheckpoint(id)
    if (ref) {
      await this.store.deleteCheckpointData(ref)
    }
  }

  // ============ Utility ============

  /**
   * Check if a ref exists
   */
  async hasRef(ref: Ref): Promise<boolean> {
    if (ref === ROOT_REF) return true
    this.ensureOpen()
    return this.store.hasNode(ref)
  }
}

/**
 * Create and open a VersionDAG with a new Dexie database
 * @param dbName The name for the IndexedDB database
 */
export async function createVersionDAG(dbName: string): Promise<VersionDAG> {
  const store = VersionStore.create(dbName)
  const dag = new VersionDAG(store)
  await dag.open()
  return dag
}

/**
 * Create and open a VersionDAG with an existing VersionStore
 */
export async function createVersionDAGWithStore(store: VersionStore): Promise<VersionDAG> {
  const dag = new VersionDAG(store)
  await dag.open()
  return dag
}

/**
 * Create and open a VersionDAG with an existing VersionDatabase
 */
export async function createVersionDAGWithDatabase(db: VersionDatabase): Promise<VersionDAG> {
  const store = new VersionStore(db)
  const dag = new VersionDAG(store)
  await dag.open()
  return dag
}
