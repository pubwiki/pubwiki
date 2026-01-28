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
import type { Quad as SyncQuad } from '@pubwiki/api'
import type { Checkpoint } from '../types.js'

// ============ Database Records ============

export interface CheckpointRecord {
  /** Primary key - unique checkpoint ID */
  id: string
  /** User-provided title */
  title: string
  /** Optional description */
  description?: string
  /** Creation timestamp */
  timestamp: number
  /** Number of quads in checkpoint */
  quadCount: number
}

export interface CheckpointDataRecord {
  /** Primary key - checkpoint ID */
  id: string
  /** Quad array stored directly (no serialization needed) */
  data: SyncQuad[]
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
    await this.db.checkpoints.put({
      id: checkpoint.id,
      title: checkpoint.title,
      description: checkpoint.description,
      timestamp: checkpoint.timestamp,
      quadCount: checkpoint.quadCount
    })
  }

  /**
   * Get checkpoint metadata by id
   */
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    const record = await this.db.checkpoints.get(id)
    if (!record) return null
    
    return {
      id: record.id,
      title: record.title,
      description: record.description,
      timestamp: record.timestamp,
      quadCount: record.quadCount
    }
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
    const records = await this.db.checkpoints
      .orderBy('timestamp')
      .reverse()
      .toArray()
    
    return records.map(record => ({
      id: record.id,
      title: record.title,
      description: record.description,
      timestamp: record.timestamp,
      quadCount: record.quadCount
    }))
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
  async saveCheckpointData(id: string, data: SyncQuad[]): Promise<void> {
    await this.db.checkpointData.put({ id, data })
  }

  /**
   * Get checkpoint quad data
   */
  async getCheckpointData(id: string): Promise<SyncQuad[] | null> {
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
