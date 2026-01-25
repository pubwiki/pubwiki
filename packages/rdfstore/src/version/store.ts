/**
 * VersionStore - Dexie-based storage for Version DAG
 * 
 * Provides persistent storage for version nodes, checkpoints, and metadata
 * using IndexedDB via Dexie.js.
 * 
 * Note on storage format:
 * - Operation objects are stored as SyncOperation (simple string-based format)
 *   which IndexedDB's structured clone can handle directly.
 * - SyncOperation is from @pubwiki/rdfsync and contains only primitive types.
 * - When reading, we convert back to Operation with RDF.js Quads.
 */

import Dexie, { type Table } from 'dexie'
import type { Operation as SyncOperation, Quad as SyncQuad } from '@pubwiki/rdfsync'
import type { Ref, RefNode, Checkpoint } from '../types.js'
import { toSyncOperation, fromSyncOperation } from '../types.js'

// ============ Database Records ============

export interface RefNodeRecord {
  /** Primary key - the ref */
  ref: string
  /** Parent ref or null for root-derived nodes */
  parent: string | null
  /** SyncOperation stored directly (no JSON serialization needed) */
  operation: SyncOperation
  /** Creation timestamp */
  timestamp: number
}

export interface ChildrenRecord {
  /** Primary key - parent ref */
  parentRef: string
  /** Array of child refs */
  children: string[]
}

export interface CheckpointRecord {
  /** Primary key - unique checkpoint ID */
  id: string
  /** The ref this checkpoint is for */
  ref: string
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
  /** Primary key - the ref */
  ref: string
  /** Quad array stored directly (no serialization needed) */
  data: SyncQuad[]
}

export interface MetaRecord {
  /** Primary key - meta key name */
  key: string
  /** Value - currently only stores 'head' (Ref string) */
  value: string
}

// ============ Dexie Database ============

/**
 * Dexie database for version storage
 */
export class VersionDatabase extends Dexie {
  refNodes!: Table<RefNodeRecord>
  children!: Table<ChildrenRecord>
  checkpoints!: Table<CheckpointRecord>
  checkpointData!: Table<CheckpointDataRecord>
  meta!: Table<MetaRecord>

  constructor(name: string) {
    super(name)
    this.version(1).stores({
      refNodes: 'ref, parent, timestamp',
      children: 'parentRef',
      checkpoints: 'id, ref, timestamp',
      checkpointData: 'ref',
      meta: 'key'
    })
  }
}

// ============ VersionStore API ============

/**
 * High-level store for version DAG data
 */
export class VersionStore {
  private db: VersionDatabase

  constructor(db: VersionDatabase) {
    this.db = db
  }

  /**
   * Create a VersionStore with a new database
   */
  static create(dbName: string): VersionStore {
    const db = new VersionDatabase(dbName)
    return new VersionStore(db)
  }

  /**
   * Get the underlying Dexie database
   */
  get database(): VersionDatabase {
    return this.db
  }

  /**
   * Close the database
   */
  async close(): Promise<void> {
    this.db.close()
  }

  // ============ RefNode Operations ============

  /**
   * Save a ref node
   */
  async saveNode(node: RefNode): Promise<void> {
    await this.db.refNodes.put({
      ref: node.ref,
      parent: node.parent,
      operation: toSyncOperation(node.operation),
      timestamp: node.timestamp
    })
  }

  /**
   * Get a ref node by ref
   */
  async getNode(ref: Ref): Promise<RefNode | null> {
    const record = await this.db.refNodes.get(ref)
    if (!record) return null
    
    return {
      ref: record.ref,
      parent: record.parent,
      operation: fromSyncOperation(record.operation),
      timestamp: record.timestamp
    }
  }

  /**
   * Delete a ref node
   */
  async deleteNode(ref: Ref): Promise<void> {
    await this.db.refNodes.delete(ref)
  }

  /**
   * Check if a ref node exists
   */
  async hasNode(ref: Ref): Promise<boolean> {
    const count = await this.db.refNodes.where('ref').equals(ref).count()
    return count > 0
  }

  // ============ Children Index Operations ============

  /**
   * Get children of a ref
   */
  async getChildren(parentRef: Ref): Promise<Ref[]> {
    const record = await this.db.children.get(parentRef)
    return record?.children ?? []
  }

  /**
   * Add a child to a parent's children list
   */
  async addChild(parentRef: Ref, childRef: Ref): Promise<void> {
    const existing = await this.db.children.get(parentRef)
    const children = existing?.children ?? []
    
    if (!children.includes(childRef)) {
      children.push(childRef)
      await this.db.children.put({ parentRef, children })
    }
  }

  /**
   * Remove a child from a parent's children list
   */
  async removeChild(parentRef: Ref, childRef: Ref): Promise<void> {
    const existing = await this.db.children.get(parentRef)
    if (!existing) return
    
    const children = existing.children.filter(c => c !== childRef)
    await this.db.children.put({ parentRef, children })
  }

  // ============ Checkpoint Operations ============

  /**
   * Save checkpoint metadata
   */
  async saveCheckpoint(checkpoint: Checkpoint): Promise<void> {
    await this.db.checkpoints.put({
      id: checkpoint.id,
      ref: checkpoint.ref,
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
      ref: record.ref,
      title: record.title,
      description: record.description,
      timestamp: record.timestamp,
      quadCount: record.quadCount
    }
  }

  /**
   * Check if a checkpoint exists for a ref
   */
  async hasCheckpointForRef(ref: Ref): Promise<boolean> {
    const count = await this.db.checkpoints.where('ref').equals(ref).count()
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
      ref: record.ref,
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
  async saveCheckpointData(ref: Ref, data: SyncQuad[]): Promise<void> {
    await this.db.checkpointData.put({ ref, data })
  }

  /**
   * Get checkpoint quad data
   */
  async getCheckpointData(ref: Ref): Promise<SyncQuad[] | null> {
    const record = await this.db.checkpointData.get(ref)
    return record?.data ?? null
  }

  /**
   * Delete checkpoint data
   */
  async deleteCheckpointData(ref: Ref): Promise<void> {
    await this.db.checkpointData.delete(ref)
  }

  // ============ Meta Operations ============

  /**
   * Set head ref
   */
  async setHead(ref: Ref): Promise<void> {
    await this.db.meta.put({ key: 'head', value: ref })
  }

  /**
   * Get head ref
   */
  async getHead(): Promise<Ref | null> {
    const record = await this.db.meta.get('head')
    return record?.value ?? null
  }
}
