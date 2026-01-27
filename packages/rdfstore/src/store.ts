/**
 * RDF Store with Immutable Version DAG
 * 
 * High-level API for RDF storage with immutable state versioning.
 * Each operation creates a new ref, enabling checkout to any historical state
 * and implicit branching.
 * 
 * Storage architecture:
 * - Quadstore (RDF data): Uses abstract-level (browser-level/memory-level)
 * - VersionDAG (version metadata): Uses Dexie.js (IndexedDB)
 */

import { DataFactory } from 'n3'
import type { Quad, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph } from '@rdfjs/types'
import type {
  QuadPattern,
  Operation,
  Ref,
  RefNode,
  Checkpoint,
  CheckpointOptions,
  StoreConfig,
  StoreEvents,
  LevelInstance,
} from './types.js'
import { ROOT_REF } from './types.js'
import { StoreBackend, createBackend } from './backend/quadstore.js'
import { VersionDAG, createVersionDAG } from './version/index.js'
import { EventEmitter } from './utils/events.js'
import {
  exportQuads,
  importQuads,
  exportFullState,
  importFullState,
  type ExportOptions,
  type ImportOptions,
  type FullStateExportOptions,
} from './serialization/index.js'
import { Engine } from 'quadstore-comunica'

const { defaultGraph, quad } = DataFactory

/**
 * SPARQL binding result - variable name to RDF term value
 */
export type SparqlBinding = Record<string, unknown>

/**
 * Storage configuration for RDFStore
 */
export interface StorageConfig {
  /** abstract-level instance for Quadstore (RDF data) */
  quadstoreLevel: LevelInstance
  /** Dexie database name for VersionDAG (version metadata) */
  versionDbName: string
}

/**
 * RDF Store with immutable version DAG
 */
export class RDFStore {
  private backend: StoreBackend
  private versionDAG: VersionDAG
  private events = new EventEmitter<StoreEvents & Record<string, unknown>>()
  private _isOpen = false
  private level: LevelInstance
  private sparqlEngine: Engine | null = null

  private constructor(
    level: LevelInstance,
    backend: StoreBackend,
    versionDAG: VersionDAG,
    _config: StoreConfig
  ) {
    this.level = level
    this.backend = backend
    this.versionDAG = versionDAG
  }

  /**
   * Create a new RDF store with separate storage backends
   * @param storage Storage configuration with quadstore level and version db name
   * @param config Optional store configuration
   */
  static async create(
    storage: StorageConfig,
    _config: Partial<StoreConfig> = {}
  ): Promise<RDFStore> {
    const fullConfig: StoreConfig = {}

    // Ensure level is open
    if (storage.quadstoreLevel.status !== 'open') {
      await storage.quadstoreLevel.open()
    }

    const backend = await createBackend(storage.quadstoreLevel)
    const versionDAG = await createVersionDAG(storage.versionDbName)

    const store = new RDFStore(storage.quadstoreLevel, backend, versionDAG, fullConfig)
    store._isOpen = true
    
    // Initialize SPARQL engine
    store.sparqlEngine = new Engine(backend.store)

    return store
  }

  /**
   * Open an existing RDF store (alias for create)
   */
  static async open(
    storage: StorageConfig,
    config: Partial<StoreConfig> = {}
  ): Promise<RDFStore> {
    return RDFStore.create(storage, config)
  }

  /**
   * Check if the store is open
   */
  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Get the current state reference
   */
  get currentRef(): Ref {
    return this.versionDAG.currentRef
  }

  /**
   * Get the underlying backend (for advanced operations)
   */
  getBackend(): StoreBackend {
    return this.backend
  }

  /**
   * Get the underlying level instance (quadstore storage)
   */
  getLevel(): LevelInstance {
    return this.level
  }

  /**
   * Get the underlying VersionDAG
   */
  getVersionDAG(): VersionDAG {
    return this.versionDAG
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this._isOpen) return

    await this.versionDAG.close()
    await this.backend.close()
    await this.level.close()
    this.events.removeAllListeners()
    this._isOpen = false
  }

  // ========== Basic CRUD Operations ==========

  /**
   * Insert a quad
   * @returns The new ref after this operation
   */
  async insert(
    subject: Quad_Subject, 
    predicate: Quad_Predicate, 
    object: Quad_Object, 
    graph?: Quad_Graph
  ): Promise<Ref> {
    const q = quad(subject, predicate, object, graph ?? defaultGraph())
    const operation: Operation = { type: 'insert', quad: q }

    await this.backend.insert(q)
    const ref = await this.versionDAG.recordOperation(operation)

    this.events.emit('change', { ref, operation })
    return ref
  }

  /**
   * Delete quads matching the pattern
   * @returns The new ref after this operation (or current ref if nothing deleted)
   */
  async delete(
    subject: Quad_Subject,
    predicate: Quad_Predicate,
    object?: Quad_Object | null,
    graph?: Quad_Graph | null
  ): Promise<Ref> {
    // Find matching quads
    const pattern: QuadPattern = { subject, predicate }
    if (object !== undefined && object !== null) {
      pattern.object = object
    }
    if (graph !== undefined && graph !== null) {
      pattern.graph = graph
    }

    const matches = await this.backend.query(pattern)
    
    if (matches.length === 0) {
      return this.currentRef
    }

    // Delete all matches as a batch
    for (const q of matches) {
      await this.backend.delete(q)
    }

    const operation: Operation = matches.length === 1
      ? { type: 'delete', quad: matches[0] }
      : { type: 'batch-delete', quads: matches }

    const ref = await this.versionDAG.recordOperation(operation)
    this.events.emit('change', { ref, operation })
    return ref
  }

  /**
   * Query quads matching a pattern
   */
  async query(pattern: QuadPattern): Promise<Quad[]> {
    return this.backend.query(pattern)
  }

  /**
   * Get all quads in the store
   */
  async getAllQuads(): Promise<Quad[]> {
    return this.backend.getAllQuads()
  }

  /**
   * Batch insert multiple quads
   * @returns The new ref after this operation
   */
  async batchInsert(quads: Quad[]): Promise<Ref> {
    if (quads.length === 0) {
      return this.currentRef
    }

    await this.backend.batchInsert(quads)
    const operation: Operation = { type: 'batch-insert', quads }
    const ref = await this.versionDAG.recordOperation(operation)

    this.events.emit('change', { ref, operation })
    return ref
  }

  /**
   * Batch delete quads matching patterns
   * @returns The new ref after this operation
   */
  async batchDelete(patterns: QuadPattern[]): Promise<Ref> {
    if (patterns.length === 0) {
      return this.currentRef
    }

    const allDeleted: Quad[] = []

    for (const pattern of patterns) {
      const deleted = await this.backend.batchDelete(pattern)
      allDeleted.push(...deleted)
    }

    if (allDeleted.length === 0) {
      return this.currentRef
    }

    const operation: Operation = { type: 'batch-delete', quads: allDeleted }
    const ref = await this.versionDAG.recordOperation(operation)

    this.events.emit('change', { ref, operation })
    return ref
  }

  // ========== Version Control ==========

  /**
   * Checkout to a specific ref
   * Rebuilds the store state to match that ref
   */
  async checkout(targetRef: Ref): Promise<void> {
    if (targetRef === this.currentRef) return

    // Verify ref exists
    if (targetRef !== ROOT_REF && !(await this.versionDAG.hasRef(targetRef))) {
      throw new Error(`Ref not found: ${targetRef}`)
    }

    const fromRef = this.currentRef

    // Find nearest checkpoint on path to target
    const checkpointInfo = await this.versionDAG.findNearestCheckpoint(targetRef)

    // Clear current state
    await this.backend.clear()

    if (checkpointInfo) {
      const { checkpointRef, pathFromCheckpoint } = checkpointInfo

      // Load checkpoint data (if not root)
      if (checkpointRef !== ROOT_REF) {
        const checkpointData = await this.versionDAG.loadCheckpointData(checkpointRef)
        if (checkpointData) {
          await this.backend.batchInsert(checkpointData)
        }
      }

      // Replay operations from checkpoint to target
      for (const ref of pathFromCheckpoint) {
        const node = await this.versionDAG.getNode(ref)
        if (node) {
          await this.applyOperationDirectly(node.operation)
        }
      }
    }

    // Update current ref
    await this.versionDAG.setCurrentRef(targetRef)

    this.events.emit('checkout', { from: fromRef, to: targetRef })
  }

  /**
   * Create a checkpoint at the current ref
   * Saves the complete quad data for faster future checkouts
   * @param options Checkpoint options including title and description
   * @returns The created checkpoint
   */
  async checkpoint(options: CheckpointOptions): Promise<Checkpoint> {
    const quads = await this.backend.getAllQuads()
    return this.versionDAG.createCheckpoint(quads, options)
  }

  /**
   * Get operation history from current ref to root
   * @param limit Maximum number of entries
   */
  async log(limit?: number): Promise<RefNode[]> {
    return this.versionDAG.log(limit)
  }

  /**
   * Get operations from baseRef to targetRef (exclusive baseRef, inclusive targetRef)
   * Returns nodes in chronological order (oldest first)
   * Used for syncing operations to cloud
   */
  async getOperationsBetween(baseRef: Ref, targetRef: Ref): Promise<RefNode[]> {
    return this.versionDAG.getOperationsBetween(baseRef, targetRef)
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    return this.versionDAG.listCheckpoints()
  }

  /**
   * Delete a checkpoint by id
   * Note: This only deletes the checkpoint metadata and data, not the underlying operations
   * @param id - The checkpoint id
   * @param ref - The ref to delete checkpoint data for (optional)
   */
  async deleteCheckpoint(id: string, ref?: Ref): Promise<void> {
    return this.versionDAG.deleteCheckpoint(id, ref)
  }

  /**
   * Check if a ref exists in the version history
   */
  async hasRef(ref: Ref): Promise<boolean> {
    return this.versionDAG.hasRef(ref)
  }

  /**
   * Get children refs (branches from a ref)
   */
  async getChildren(ref: Ref): Promise<Ref[]> {
    return this.versionDAG.getChildren(ref)
  }

  // ========== Events ==========

  /**
   * Subscribe to store events
   */
  on<K extends keyof StoreEvents>(
    event: K,
    callback: (data: StoreEvents[K]) => void
  ): () => void {
    return this.events.on(event, callback)
  }

  // ========== SPARQL Query ==========

  /**
   * Execute a SPARQL query and return results as an async iterator
   * @param sparql The SPARQL query string
   * @returns An async iterator of bindings
   */
  async *sparqlQuery(sparql: string): AsyncIterableIterator<SparqlBinding> {
    if (!this.sparqlEngine) {
      throw new Error('SPARQL engine not initialized')
    }

    const bindingsStream = await this.sparqlEngine.queryBindings(sparql)
    
    // ResultStream supports async iteration at runtime but types are incomplete
    for await (const binding of bindingsStream as unknown as AsyncIterable<Map<{ value: string }, unknown>>) {
      // Convert RDF/JS Bindings to plain object
      const result: SparqlBinding = {}
      for (const [key, value] of binding) {
        result[key.value] = value
      }
      yield result
    }
  }

  // ========== Transaction ==========

  /**
   * Execute a callback within a transaction context.
   * If the callback throws an error, all changes are rolled back and
   * the created refs are deleted from the DAG.
   * If the callback succeeds, changes are committed.
   * 
   * @param callback The function to execute within the transaction
   * @returns The result of the callback
   * @throws Re-throws any error from the callback after rollback
   */
  async transaction<T>(callback: () => T | Promise<T>): Promise<T> {
    const startRef = this.currentRef

    try {
      const result = await callback()
      return result
    } catch (error) {
      // Collect all refs created during the transaction
      const refsToDelete: string[] = []
      let current = this.currentRef
      while (current !== startRef && current !== ROOT_REF) {
        refsToDelete.push(current)
        const node = await this.versionDAG.getNode(current)
        if (!node || !node.parent) break
        current = node.parent
      }

      // Delete the refs in reverse order (from newest to oldest)
      for (const ref of refsToDelete) {
        await this.versionDAG.deleteRef(ref)
      }

      // Rollback to the state before the transaction
      if (this.currentRef !== startRef) {
        await this.checkout(startRef)
      }

      throw error
    }
  }

  // ========== Import/Export ==========

  /**
   * Export all quads to a string format
   */
  async exportData(options: Partial<ExportOptions> = {}): Promise<string> {
    const quads = await this.backend.getAllQuads()
    return exportQuads(quads, {
      format: options.format ?? 'jsonl',
      includeMetadata: options.includeMetadata,
      pretty: options.pretty,
    })
  }

  /**
   * Import quads from a string format
   * @returns The new ref after import
   */
  async importData(data: string, options: ImportOptions = {}): Promise<Ref> {
    const quads = importQuads(data, options)
    
    if (quads.length > 0) {
      return this.batchInsert(quads)
    }
    
    return this.currentRef
  }

  /**
   * Replace all data with imported quads (clears existing data first)
   * @returns The new ref after import
   */
  async replaceWithImport(data: string, options: ImportOptions = {}): Promise<Ref> {
    const quads = importQuads(data, options)
    
    // Clear existing data
    await this.backend.clear()
    
    if (quads.length > 0) {
      await this.backend.batchInsert(quads)
      
      const operation: Operation = { type: 'batch-insert', quads }
      const ref = await this.versionDAG.recordOperation(operation)
      
      this.events.emit('change', { ref, operation })
      return ref
    }
    
    return this.currentRef
  }

  /**
   * Export the complete store state including version history and checkpoints
   * This exports everything needed to fully restore the store state
   * 
   * @param options - Export options (e.g., pretty print)
   * @returns JSON string of the full state
   */
  async exportFullState(options: FullStateExportOptions = {}): Promise<string> {
    const versionStore = this.versionDAG.getStore()
    return exportFullState(this.backend, versionStore, options)
  }

  /**
   * Import a complete store state from a full state export
   * WARNING: This completely replaces all current data including version history!
   * 
   * @param data - JSON string from exportFullState
   */
  async importFullState(data: string): Promise<void> {
    const versionStore = this.versionDAG.getStore()
    await importFullState(this.backend, versionStore, data)
    
    // Sync the VersionDAG's internal currentRef with the restored head
    const head = await versionStore.getHead()
    if (head) {
      await this.versionDAG.setCurrentRef(head)
    }
  }

  // ========== Private Methods ==========

  /**
   * Apply operation directly without recording
   */
  private async applyOperationDirectly(operation: Operation): Promise<void> {
    switch (operation.type) {
      case 'insert':
        await this.backend.insert(operation.quad)
        break

      case 'delete':
        await this.backend.delete(operation.quad)
        break

      case 'batch-insert':
        await this.backend.batchInsert(operation.quads)
        break

      case 'batch-delete':
        for (const q of operation.quads) {
          await this.backend.delete(q)
        }
        break
    }
  }
}
