/**
 * CheckpointStore - Dexie-based storage for Checkpoints
 * 
 * Provides persistent storage for checkpoint metadata and data
 * using IndexedDB via Dexie.js.
 * 
 * 重构后：移除了 RefNode、Children 等操作历史相关的表
 * 简化为纯 Checkpoint 快照存储
 */

import Dexie, { type Table } from 'dexie'
import type { SerializedQuad } from '../convert.js'
import type { Checkpoint } from '../types.js'

// ============ Database Records ============

/**
 * Dexie record type — currently identical to Checkpoint.
 * Kept as alias so store internals don't depend on the domain type directly.
 */
export type CheckpointRecord = Checkpoint

export interface CheckpointDataRecord {
  /** Primary key - checkpoint ID */
  id: string
  /** Quad array stored directly (no serialization needed) */
  data: SerializedQuad[]
}

// ============ Dexie Database ============

/**
 * Dexie database for checkpoint storage
 */
export class CheckpointDatabase extends Dexie {
  checkpoints!: Table<CheckpointRecord>
  checkpointData!: Table<CheckpointDataRecord>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      checkpoints: 'id, timestamp',
      checkpointData: 'id',
    })
  }
}

// ============ CheckpointStore API ============

/**
 * High-level store for checkpoint data
 */
export class CheckpointStore {
  private db: CheckpointDatabase

  constructor(db: CheckpointDatabase) {
    this.db = db
  }

  /**
   * Create a CheckpointStore with a new database
   */
  static create(dbName: string): CheckpointStore {
    const db = new CheckpointDatabase(dbName)
    return new CheckpointStore(db)
  }

  /**
   * Get the underlying Dexie database
   */
  get database(): CheckpointDatabase {
    return this.db
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    this.db.close()
  }

  // ============ Checkpoint Operations ============

  /**
   * Save checkpoint metadata
   */
  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await this.db.checkpoints.put(checkpoint)
  }

  /**
   * Get checkpoint metadata by id
   */
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    return await this.db.checkpoints.get(id) ?? null
  }

  /**
   * Check if a checkpoint exists
   */
  async hasCheckpoint(id: string): Promise<boolean> {
    const count = await this.db.checkpoints.where('id').equals(id).count()
    return count > 0
  }

  /**
   * List all checkpoints, sorted by timestamp descending
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    return this.db.checkpoints
      .orderBy('timestamp')
      .reverse()
      .toArray()
  }

  /**
   * Delete checkpoint metadata by id
   */
  async deleteCheckpoint(id: string): Promise<void> {
    await this.db.checkpoints.delete(id)
  }

  // ============ Checkpoint Data Operations ============

  /**
   * Save checkpoint quad data
   */
  async saveCheckpointData(id: string, data: SerializedQuad[]): Promise<void> {
    await this.db.checkpointData.put({ id, data })
  }

  /**
   * Get checkpoint quad data
   */
  async getCheckpointData(id: string): Promise<SerializedQuad[] | null> {
    const record = await this.db.checkpointData.get(id)
    return record?.data ?? null
  }

  /**
   * Delete checkpoint data
   */
  async deleteCheckpointData(id: string): Promise<void> {
    await this.db.checkpointData.delete(id)
  }

  /**
   * Clear all data (for testing or reset)
   */
  async clear(): Promise<void> {
    await this.db.checkpoints.clear()
    await this.db.checkpointData.clear()
  }
}
