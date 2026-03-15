/**
 * RDF Store with Checkpoint-based Versioning
 * 
 * High-level API for RDF storage with checkpoint-based versioning.
 * Users can create checkpoints (snapshots) at any time.
 * 
 * Storage architecture:
 * - Quadstore (RDF data): Uses abstract-level (browser-level/memory-level)
 * - Checkpoints (version snapshots): Uses Dexie.js (IndexedDB)
 * 
 * 重构后：移除了区块链式版本控制，简化为纯 Checkpoint 快照模式
 */

import { DataFactory } from 'n3'
import type { Quad, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph } from '@rdfjs/types'
import type {
  QuadPattern,
  Checkpoint,
  CheckpointOptions,
  StoreEvents,
  LevelInstance,
} from './types.js'
import { StoreBackend, createBackend } from './backend/quadstore.js'
import { CheckpointManager, createCheckpointManager } from './version/index.js'
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
  /** Dexie database name for Checkpoints */
  checkpointDbName: string
}

/**
 * RDF Store with checkpoint-based versioning
 */
export class RDFStore {
  private backend: StoreBackend
  private checkpointManager: CheckpointManager
  private events = new EventEmitter<StoreEvents & Record<string, unknown>>()
  private _isOpen = false
  private level: LevelInstance
  private sparqlEngine: Engine | null = null

  private constructor(
    level: LevelInstance,
    backend: StoreBackend,
    checkpointManager: CheckpointManager
  ) {
    this.level = level
    this.backend = backend
    this.checkpointManager = checkpointManager
  }

  /**
   * Create a new RDF store with separate storage backends
   * @param storage Storage configuration with quadstore level and checkpoint db name
   */
  static async create(
    storage: StorageConfig
  ): Promise<RDFStore> {
    // Ensure level is open
    if (storage.quadstoreLevel.status !== 'open') {
      await storage.quadstoreLevel.open()
    }

    const backend = await createBackend(storage.quadstoreLevel)
    const checkpointManager = await createCheckpointManager(storage.checkpointDbName)

    const store = new RDFStore(storage.quadstoreLevel, backend, checkpointManager)
    store._isOpen = true
    
    // Initialize SPARQL engine
    store.sparqlEngine = new Engine(backend.store)

    return store
  }

  /**
   * Open an existing RDF store (alias for create)
   */
  static async open(
    storage: StorageConfig
  ): Promise<RDFStore> {
    return RDFStore.create(storage)
  }

  /**
   * Check if the store is open
   */
  get isOpen(): boolean {
    return this._isOpen
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
   * Get the underlying CheckpointManager
   */
  getCheckpointManager(): CheckpointManager {
    return this.checkpointManager
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this._isOpen) return

    await this.checkpointManager.close()
    await this.backend.close()
    await this.level.close()
    this.events.removeAllListeners()
    this._isOpen = false
  }

  // ========== Basic CRUD Operations ==========

  /**
   * Insert a quad
   */
  async insert(
    subject: Quad_Subject, 
    predicate: Quad_Predicate, 
    object: Quad_Object, 
    graph?: Quad_Graph
  ): Promise<void> {
    const q = quad(subject, predicate, object, graph ?? defaultGraph())
    await this.backend.insert(q)
  }

  /**
   * Delete quads matching the pattern
   */
  async delete(
    subject: Quad_Subject,
    predicate: Quad_Predicate,
    object?: Quad_Object | null,
    graph?: Quad_Graph | null
  ): Promise<void> {
    // Find matching quads
    const pattern: QuadPattern = { subject, predicate }
    if (object !== undefined && object !== null) {
      pattern.object = object
    }
    if (graph !== undefined && graph !== null) {
      pattern.graph = graph
    }

    const matches = await this.backend.query(pattern)
    
    // Delete all matches
    for (const q of matches) {
      await this.backend.delete(q)
    }
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
   */
  async batchInsert(quads: Quad[]): Promise<void> {
    if (quads.length === 0) {
      return
    }
    await this.backend.batchInsert(quads)
  }

  /**
   * Batch delete quads matching patterns
   */
  async batchDelete(patterns: QuadPattern[]): Promise<void> {
    if (patterns.length === 0) {
      return
    }

    for (const pattern of patterns) {
      await this.backend.batchDelete(pattern)
    }
  }

  /**
   * Clear all quads from the store
   */
  async clear(): Promise<void> {
    await this.backend.clear()
  }

  // ========== Checkpoint Operations ==========

  /**
   * Create a checkpoint at the current state
   * Saves the complete quad data for future restoration
   * @param options Checkpoint options including title and description
   * @returns The created checkpoint
   */
  async checkpoint(options: CheckpointOptions): Promise<Checkpoint> {
    const quads = await this.backend.getAllQuads()
    const checkpoint = await this.checkpointManager.createCheckpoint(quads, options)
    this.events.emit('checkpointCreated', { checkpointId: checkpoint.id })
    return checkpoint
  }

  /**
   * Load a checkpoint's data into the store
   * WARNING: This replaces all current data!
   * @param checkpointId The checkpoint ID to load
   */
  async loadCheckpoint(checkpointId: string): Promise<void> {
    const data = await this.checkpointManager.loadCheckpointData(checkpointId)
    if (data === null) {
      throw new Error(`Checkpoint not found: ${checkpointId}`)
    }

    // Clear current state and load checkpoint data
    await this.backend.clear()
    if (data.length > 0) {
      await this.backend.batchInsert(data)
    }

    this.events.emit('checkpointLoaded', { checkpointId })
  }

  /**
   * Get checkpoint metadata by ID
   */
  async getCheckpoint(id: string): Promise<Checkpoint | null> {
    return this.checkpointManager.getCheckpoint(id)
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<Checkpoint[]> {
    return this.checkpointManager.listCheckpoints()
  }

  /**
   * Delete a checkpoint by id
   * @param id - The checkpoint id
   */
  async deleteCheckpoint(id: string): Promise<void> {
    return this.checkpointManager.deleteCheckpoint(id)
  }

  /**
   * Check if a checkpoint exists
   */
  async hasCheckpoint(id: string): Promise<boolean> {
    return this.checkpointManager.hasCheckpoint(id)
  }

  /**
   * Get raw serialized quad data for a checkpoint (for upload without deserialization)
   */
  async getCheckpointRawData(id: string): Promise<import('./convert.js').SerializedQuad[] | null> {
    return this.checkpointManager.getCheckpointRawData(id)
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
   */
  async importData(data: string, options: ImportOptions = {}): Promise<void> {
    const quads = importQuads(data, options)
    
    if (quads.length > 0) {
      await this.batchInsert(quads)
    }
  }

  /**
   * Replace all data with imported quads (clears existing data first)
   */
  async replaceWithImport(data: string, options: ImportOptions = {}): Promise<void> {
    const quads = importQuads(data, options)
    
    // Clear existing data
    await this.backend.clear()
    
    if (quads.length > 0) {
      await this.backend.batchInsert(quads)
    }
  }

  /**
   * Export the complete store state including checkpoints
   * This exports everything needed to fully restore the store state
   * 
   * @param options - Export options (e.g., pretty print)
   * @returns JSON string of the full state
   */
  async exportFullState(options: FullStateExportOptions = {}): Promise<string> {
    const checkpointStore = this.checkpointManager.getStore()
    return exportFullState(this.backend, checkpointStore, options)
  }

  /**
   * Import a complete store state from a full state export
   * WARNING: This completely replaces all current data including checkpoints!
   * 
   * @param data - JSON string from exportFullState
   */
  async importFullState(data: string): Promise<void> {
    const checkpointStore = this.checkpointManager.getStore()
    await importFullState(this.backend, checkpointStore, data)
  }
}
