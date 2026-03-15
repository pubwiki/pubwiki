/**
 * CheckpointManager - Checkpoint management API
 * 
 * Manages checkpoint creation, loading, and listing.
 * 
 * 重构后：移除了 VersionDAG 中的操作历史相关功能
 * 简化为纯 Checkpoint 管理
 */

import type { Quad } from '@rdfjs/types'
import type { Checkpoint, CheckpointOptions } from '../types.js'
import { fromRdfQuad, toRdfQuad } from '../convert.js'
import { CheckpointStore, CheckpointDatabase } from './store.js'

/**
 * Checkpoint Manager
 * 
 * Manages checkpoints using Dexie.js storage
 */
export class CheckpointManager {
  private store: CheckpointStore
  private _isOpen = false

  constructor(store: CheckpointStore) {
    this.store = store
  }

  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Get the underlying CheckpointStore
   */
  getStore(): CheckpointStore {
    return this.store
  }

  /**
   * Open the checkpoint manager
   */
  async open(): Promise<void> {
    if (this._isOpen) return
    this._isOpen = true
  }

  /**
   * Close the checkpoint manager
   */
  async close(): Promise<void> {
    if (!this._isOpen) return
    await this.store.close()
    this._isOpen = false
  }

  private ensureOpen(): void {
    if (!this._isOpen) {
      throw new Error('CheckpointManager not open')
    }
  }

  // ============ Checkpoint Operations ============

  /**
   * Create a checkpoint with the given quads
   * @param quads The current quad data to save
   * @param options Checkpoint options including title and description
   * @returns The checkpoint (including id)
   */
  async createCheckpoint(quads: Quad[], options: CheckpointOptions): Promise<Checkpoint> {
    this.ensureOpen()
    const id = options.id ?? crypto.randomUUID()
    
    // Convert RDF.js Quads to serializable format
    const data = quads.map(fromRdfQuad)

    // Save checkpoint metadata
    const checkpoint: Checkpoint = {
      id,
      title: options.title,
      description: options.description,
      timestamp: Date.now(),
      quadCount: quads.length,
    }
    await this.store.saveCheckpoint(checkpoint)

    // Save checkpoint data
    await this.store.saveCheckpointData(id, data)

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
   * Load checkpoint data for a checkpoint id
   */
  async loadCheckpointData(id: string): Promise<Quad[] | null> {
    this.ensureOpen()
    const data = await this.store.getCheckpointData(id)
    if (data === null) return null
    return data.map(toRdfQuad)
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
   * @param id - The checkpoint id
   */
  async deleteCheckpoint(id: string): Promise<void> {
    this.ensureOpen()
    await this.store.deleteCheckpoint(id)
    await this.store.deleteCheckpointData(id)
  }

  /**
   * Check if a checkpoint exists
   */
  async hasCheckpoint(id: string): Promise<boolean> {
    this.ensureOpen()
    return this.store.hasCheckpoint(id)
  }

  /**
   * Get raw serialized quad data for a checkpoint (for upload)
   */
  async getCheckpointRawData(id: string): Promise<import('../convert.js').SerializedQuad[] | null> {
    this.ensureOpen()
    return this.store.getCheckpointData(id)
  }
}

/**
 * Create and open a CheckpointManager with a new Dexie database
 * @param dbName The name for the IndexedDB database
 */
export async function createCheckpointManager(dbName: string): Promise<CheckpointManager> {
  const store = CheckpointStore.create(dbName)
  const manager = new CheckpointManager(store)
  await manager.open()
  return manager
}

/**
 * Create and open a CheckpointManager with an existing CheckpointStore
 */
export async function createCheckpointManagerWithStore(store: CheckpointStore): Promise<CheckpointManager> {
  const manager = new CheckpointManager(store)
  await manager.open()
  return manager
}

/**
 * Create and open a CheckpointManager with an existing CheckpointDatabase
 */
export async function createCheckpointManagerWithDatabase(db: CheckpointDatabase): Promise<CheckpointManager> {
  const store = new CheckpointStore(db)
  const manager = new CheckpointManager(store)
  await manager.open()
  return manager
}
