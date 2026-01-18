/**
 * Version DAG - Immutable state versioning
 * 
 * Manages a DAG of state references where each operation creates a new ref.
 * Supports checkout to any ref and implicit branching.
 */

import type { Quad } from '@rdfjs/types'
import type { Ref, RefNode, Checkpoint, Operation, LevelInstance } from '../types.js'
import { ROOT_REF } from '../types.js'
import { exportToJsonl, importFromJsonl } from '../serialization/formats.js'
import { generateRef } from '@pubwiki/rdfsync'

// Sublevel names
const VERSION_SUBLEVEL = 'version'
const CHECKPOINT_DATA_SUBLEVEL = 'checkpoint-data'

// Key prefixes
const NODE_PREFIX = 'node:'
const CHECKPOINT_PREFIX = 'ckpt:'
const CHILDREN_PREFIX = 'children:'
const META_PREFIX = 'meta:'

/**
 * Version DAG Manager
 * 
 * Manages the immutable state DAG and checkpoints
 */
export class VersionDAG {
  private versionLevel: LevelInstance | null = null
  private checkpointDataLevel: LevelInstance | null = null
  private _currentRef: Ref = ROOT_REF
  private _isOpen = false

  constructor(private db: LevelInstance) {}

  get currentRef(): Ref {
    return this._currentRef
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Open the version DAG
   */
  async open(): Promise<void> {
    if (this._isOpen) return
    
    this.versionLevel = this.db.sublevel(VERSION_SUBLEVEL, { valueEncoding: 'utf8' }) as LevelInstance
    this.checkpointDataLevel = this.db.sublevel(CHECKPOINT_DATA_SUBLEVEL, { valueEncoding: 'utf8' }) as LevelInstance
    this._isOpen = true
    
    // Restore current ref
    const savedRef = await this.getMeta<Ref>('head')
    if (savedRef) {
      this._currentRef = savedRef
    }
  }

  /**
   * Close the version DAG
   */
  async close(): Promise<void> {
    if (!this._isOpen) return
    this.versionLevel = null
    this.checkpointDataLevel = null
    this._isOpen = false
  }

  private ensureOpen(): LevelInstance {
    if (!this._isOpen || !this.versionLevel) {
      throw new Error('VersionDAG not open')
    }
    return this.versionLevel
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
    // Generate deterministic ref using chain hash
    const ref = await generateRef(this._currentRef, operation)
    
    const node: RefNode = {
      ref,
      parent: this._currentRef,
      operation,
      timestamp: Date.now(),
    }

    // Save the node
    await this.saveNode(node)

    // Update children index of parent
    await this.addChild(this._currentRef, ref)

    // Update current ref
    this._currentRef = ref
    await this.setMeta('head', ref)

    return ref
  }

  /**
   * Save a ref node
   */
  private async saveNode(node: RefNode): Promise<void> {
    const db = this.ensureOpen()
    await db.put(`${NODE_PREFIX}${node.ref}`, JSON.stringify(node))
  }

  /**
   * Get a ref node
   */
  async getNode(ref: Ref): Promise<RefNode | null> {
    if (ref === ROOT_REF) return null
    
    const db = this.ensureOpen()
    try {
      const value = await db.get(`${NODE_PREFIX}${ref}`)
      if (value === undefined) return null
      return JSON.parse(value) as RefNode
    } catch {
      return null
    }
  }

  /**
   * Add a child to a ref's children index
   */
  private async addChild(parent: Ref, child: Ref): Promise<void> {
    const db = this.ensureOpen()
    const children = await this.getChildren(parent)
    if (!children.includes(child)) {
      children.push(child)
      await db.put(`${CHILDREN_PREFIX}${parent}`, JSON.stringify(children))
    }
  }

  /**
   * Get children of a ref
   */
  async getChildren(ref: Ref): Promise<Ref[]> {
    const db = this.ensureOpen()
    try {
      const value = await db.get(`${CHILDREN_PREFIX}${ref}`)
      if (value === undefined) return []
      return JSON.parse(value) as Ref[]
    } catch {
      return []
    }
  }

  /**
   * Remove a child from a ref's children index
   */
  private async removeChild(parent: Ref, child: Ref): Promise<void> {
    const db = this.ensureOpen()
    const children = await this.getChildren(parent)
    const index = children.indexOf(child)
    if (index !== -1) {
      children.splice(index, 1)
      await db.put(`${CHILDREN_PREFIX}${parent}`, JSON.stringify(children))
    }
  }

  /**
   * Delete a ref node and remove it from parent's children
   * Used for transaction rollback
   */
  async deleteRef(ref: Ref): Promise<void> {
    if (ref === ROOT_REF) return
    
    const db = this.ensureOpen()
    const node = await this.getNode(ref)
    if (!node) return

    // Remove from parent's children
    if (node.parent) {
      await this.removeChild(node.parent, ref)
    }

    // Delete the node
    try {
      await db.del(`${NODE_PREFIX}${ref}`)
    } catch {
      // Ignore if not found
    }
  }

  /**
   * Get the path from a ref to root
   * @returns Array of refs from the given ref to root (inclusive)
   */
  async getPathToRoot(ref: Ref): Promise<Ref[]> {
    const path: Ref[] = [ref]
    let current = ref

    while (current !== ROOT_REF) {
      const node = await this.getNode(current)
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
    const nodes: RefNode[] = []
    let current = this._currentRef

    while (current !== ROOT_REF) {
      const node = await this.getNode(current)
      if (!node) break
      nodes.push(node)
      if (limit && nodes.length >= limit) break
      current = node.parent!
    }

    return nodes
  }

  // ============ Checkout ============

  /**
   * Set the current ref (used during checkout)
   */
  async setCurrentRef(ref: Ref): Promise<void> {
    this._currentRef = ref
    await this.setMeta('head', ref)
  }

  // ============ Checkpoint Operations ============

  /**
   * Create a checkpoint at the current ref
   * @param quads The current quad data to save
   * @returns The current ref
   */
  async createCheckpoint(quads: Quad[]): Promise<Ref> {
    const ref = this._currentRef
    
    // Save checkpoint metadata
    const checkpoint: Checkpoint = {
      ref,
      timestamp: Date.now(),
      quadCount: quads.length,
    }
    const db = this.ensureOpen()
    await db.put(`${CHECKPOINT_PREFIX}${ref}`, JSON.stringify(checkpoint))

    // Save checkpoint data
    const data = exportToJsonl(quads)
    await this.checkpointDataLevel!.put(ref, data)

    return ref
  }

  /**
   * Get checkpoint metadata for a ref
   */
  async getCheckpoint(ref: Ref): Promise<Checkpoint | null> {
    const db = this.ensureOpen()
    try {
      const value = await db.get(`${CHECKPOINT_PREFIX}${ref}`)
      if (value === undefined) return null
      return JSON.parse(value) as Checkpoint
    } catch {
      return null
    }
  }

  /**
   * Load checkpoint data for a ref
   */
  async loadCheckpointData(ref: Ref): Promise<Quad[] | null> {
    if (!this.checkpointDataLevel) return null
    try {
      const data = await this.checkpointDataLevel.get(ref)
      if (data === undefined) return null
      return importFromJsonl(data)
    } catch {
      return null
    }
  }

  /**
   * Find the nearest checkpoint on the path from ref to root
   * @returns The checkpoint ref and the path from checkpoint to target
   */
  async findNearestCheckpoint(targetRef: Ref): Promise<{ checkpointRef: Ref; pathFromCheckpoint: Ref[] } | null> {
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
      
      const checkpoint = await this.getCheckpoint(ref)
      if (checkpoint) {
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
    const db = this.ensureOpen()
    const checkpoints: Checkpoint[] = []
    
    for await (const [key, value] of db.iterator()) {
      if (key.startsWith(CHECKPOINT_PREFIX)) {
        checkpoints.push(JSON.parse(value) as Checkpoint)
      }
    }
    
    return checkpoints.sort((a, b) => b.timestamp - a.timestamp)
  }

  // ============ Meta Operations ============

  private async setMeta<T>(key: string, value: T): Promise<void> {
    const db = this.ensureOpen()
    await db.put(`${META_PREFIX}${key}`, JSON.stringify(value))
  }

  private async getMeta<T>(key: string): Promise<T | null> {
    const db = this.ensureOpen()
    try {
      const value = await db.get(`${META_PREFIX}${key}`)
      if (value === undefined) return null
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  // ============ Utility ============

  /**
   * Check if a ref exists
   */
  async hasRef(ref: Ref): Promise<boolean> {
    if (ref === ROOT_REF) return true
    const node = await this.getNode(ref)
    return node !== null
  }
}

/**
 * Create and open a VersionDAG
 */
export async function createVersionDAG(level: LevelInstance): Promise<VersionDAG> {
  const dag = new VersionDAG(level)
  await dag.open()
  return dag
}
