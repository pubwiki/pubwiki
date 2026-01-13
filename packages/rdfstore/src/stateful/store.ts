/**
 * Stateful RDF Store
 * 
 * High-level API for RDF storage with version control
 */

import type {
  Triple,
  TriplePattern,
  Operation,
  LogEntry,
  SnapshotRef,
  SnapshotInfo,
  StoreConfig,
  HistoryOptions,
  StoreEvents,
  LevelInstance,
  SubjectNode,
  PredicateNode,
  ObjectNode,
} from '../types.js'
import { StoreBackend, createBackend } from '../backend/quadstore.js'
import { LogManager, createLogManager } from '../log/manager.js'
import { createCheckpointManager, type CheckpointManager } from '../checkpoint/auto.js'
import { invertOperation } from '../delta/diff.js'
import { EventEmitter } from '../utils/events.js'
import {
  exportTriples,
  importTriples,
  type ExportOptions,
  type ImportOptions,
} from '../serialization/index.js'

/**
 * RDF Store with WAL-based versioning
 */
export class RDFStore {
  private backend: StoreBackend
  private logManager: LogManager
  private checkpointManager: CheckpointManager
  private events = new EventEmitter<StoreEvents & Record<string, unknown>>()
  private _isOpen = false
  private level: LevelInstance

  private constructor(
    level: LevelInstance,
    backend: StoreBackend,
    logManager: LogManager,
    checkpointManager: CheckpointManager,
    _config: StoreConfig
  ) {
    this.level = level
    this.backend = backend
    this.logManager = logManager
    this.checkpointManager = checkpointManager
  }

  /**
   * Create a new RDF store
   * @param level - The level instance to use for storage
   * @param config - Optional configuration
   */
  static async create(
    level: LevelInstance,
    config: Partial<StoreConfig> = {}
  ): Promise<RDFStore> {
    const fullConfig: StoreConfig = {
      autoCheckpointInterval: config.autoCheckpointInterval ?? 100,
      enableAutoCheckpoint: config.enableAutoCheckpoint ?? true,
    }

    // Ensure level is open
    if (level.status !== 'open') {
      await level.open()
    }

    const backend = await createBackend(level)
    const logManager = await createLogManager(
      level,
      fullConfig.autoCheckpointInterval,
      fullConfig.enableAutoCheckpoint
    )

    const checkpointManager = createCheckpointManager(backend, logManager, fullConfig)

    const store = new RDFStore(level, backend, logManager, checkpointManager, fullConfig)
    store._isOpen = true

    // Save initial empty snapshot if this is a new store
    const existingSnapshots = await logManager.listSnapshots()
    if (existingSnapshots.length === 0) {
      await logManager.saveCheckpoint(0, 'initial', true)
    }

    return store
  }

  /**
   * Open an existing RDF store (alias for create)
   */
  static async open(
    level: LevelInstance,
    config: Partial<StoreConfig> = {}
  ): Promise<RDFStore> {
    return RDFStore.create(level, config)
  }

  /**
   * Check if the store is open
   */
  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Get the current snapshot reference
   */
  get currentRef(): SnapshotRef {
    return this.logManager.currentRef
  }

  /**
   * Get the underlying backend (for advanced operations)
   */
  getBackend(): StoreBackend {
    return this.backend
  }

  /**
   * Get the underlying level instance
   */
  getLevel(): LevelInstance {
    return this.level
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this._isOpen) return

    await this.logManager.close()
    await this.backend.close()
    await this.level.close()
    this.events.removeAllListeners()
    this._isOpen = false
  }

  // ========== Basic CRUD Operations ==========

  /**
   * Insert a triple
   */
  async insert(subject: SubjectNode, predicate: PredicateNode, object: ObjectNode): Promise<void> {
    const triple: Triple = { subject, predicate, object }
    const operation: Operation = { type: 'insert', triple }

    await this.backend.insert(triple)
    const entry = await this.logManager.recordOperation(operation)
    await this.logManager.pushToUndoStack(entry)

    this.events.emit('change', entry)
    await this.maybeAutoCheckpoint()
  }

  /**
   * Delete triples matching the pattern
   */
  async delete(
    subject: SubjectNode,
    predicate: PredicateNode,
    object?: ObjectNode | null
  ): Promise<void> {
    // Find matching triples
    const pattern: TriplePattern = { subject, predicate }
    if (object !== undefined && object !== null) {
      pattern.object = object
    }

    const matches = await this.backend.query(pattern)
    
    if (matches.length === 0) return

    // Delete each match
    for (const triple of matches) {
      await this.backend.delete(triple)
      const operation: Operation = { type: 'delete', triple }
      const entry = await this.logManager.recordOperation(operation)
      await this.logManager.pushToUndoStack(entry)
      this.events.emit('change', entry)
    }

    await this.maybeAutoCheckpoint()
  }

  /**
   * Query triples matching a pattern
   */
  async query(pattern: TriplePattern): Promise<Triple[]> {
    return this.backend.query(pattern)
  }

  /**
   * Batch insert multiple triples
   */
  async batchInsert(triples: Triple[]): Promise<void> {
    if (triples.length === 0) return

    await this.backend.batchInsert(triples)
    const operation: Operation = { type: 'batch-insert', triples }
    const entry = await this.logManager.recordOperation(operation)
    await this.logManager.pushToUndoStack(entry)

    this.events.emit('change', entry)
    await this.maybeAutoCheckpoint()
  }

  /**
   * Batch delete triples matching patterns
   */
  async batchDelete(patterns: TriplePattern[]): Promise<void> {
    if (patterns.length === 0) return

    const allDeleted: Triple[] = []

    for (const pattern of patterns) {
      const deleted = await this.backend.batchDelete(pattern)
      allDeleted.push(...deleted)
    }

    if (allDeleted.length > 0) {
      const operation: Operation = { type: 'batch-delete', triples: allDeleted }
      const entry = await this.logManager.recordOperation(operation)
      await this.logManager.pushToUndoStack(entry)

      this.events.emit('change', entry)
      await this.maybeAutoCheckpoint()
    }
  }

  // ========== Version Control ==========

  /**
   * Save current state as a named snapshot
   */
  async saveSnapshot(label?: string): Promise<SnapshotInfo> {
    const info = await this.checkpointManager.createCheckpoint(label)
    this.events.emit('snapshot', info)
    return info
  }

  /**
   * List all saved snapshots
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    return this.logManager.listSnapshots()
  }

  /**
   * Rollback to a specific snapshot
   * @returns The operations that were undone
   */
  async rollbackTo(ref: SnapshotRef): Promise<Operation[]> {
    const fromRef = this.currentRef
    
    // Get the snapshot info
    const snapshot = await this.logManager.getSnapshot(ref)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${ref}`)
    }

    // Get operations since that snapshot
    const operations = await this.logManager.getOperationsSince(ref)
    const undoneOps: Operation[] = operations.map(e => e.operation).reverse()

    // Clear current state and rebuild from checkpoint
    await this.rebuildFromSnapshot(ref)

    // Update current ref
    await this.logManager.setCurrentRef(ref)

    this.events.emit('rollback', { from: fromRef, to: ref })
    
    return undoneOps
  }

  /**
   * Undo the most recent operations
   * @param count Number of operations to undo (default: 1)
   */
  async undo(count: number = 1): Promise<Operation[]> {
    const undoneOps: Operation[] = []

    for (let i = 0; i < count; i++) {
      const entry = await this.logManager.popFromUndoStack()
      if (!entry) break

      // Apply inverse operation
      const inverse = invertOperation(entry.operation)
      await this.applyOperationDirectly(inverse)

      // Push to redo stack
      await this.logManager.pushToRedoStack(entry)

      undoneOps.push(entry.operation)
    }

    return undoneOps
  }

  /**
   * Redo previously undone operations
   * @param count Number of operations to redo (default: 1)
   */
  async redo(count: number = 1): Promise<Operation[]> {
    const redoneOps: Operation[] = []

    for (let i = 0; i < count; i++) {
      const entry = await this.logManager.popFromRedoStack()
      if (!entry) break

      // Reapply operation
      await this.applyOperationDirectly(entry.operation)

      // Push back to undo stack
      await this.logManager.pushToUndoStack(entry)

      redoneOps.push(entry.operation)
    }

    return redoneOps
  }

  /**
   * Get operation history
   */
  async getHistory(options: HistoryOptions = {}): Promise<LogEntry[]> {
    return this.logManager.getHistory(options)
  }

  /**
   * Compact history - clear logs but keep current state
   * Note: This permanently removes history
   */
  async compactHistory(): Promise<void> {
    // Save current state first
    const currentTriples = await this.backend.getAllTriples()
    
    // Clear logs
    await this.logManager.clearHistory()
    
    // Create new initial checkpoint
    await this.logManager.saveCheckpoint(
      currentTriples.length,
      'post-compaction',
      true
    )
  }

  /**
   * Delete a saved snapshot
   */
  async deleteSnapshot(ref: SnapshotRef): Promise<void> {
    await this.logManager.deleteSnapshot(ref)
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

  // ========== Import/Export ==========

  /**
   * Export all triples to a string format
   * @param format - Output format (default: 'jsonl')
   */
  async exportData(options: Partial<ExportOptions> = {}): Promise<string> {
    const triples = await this.backend.getAllTriples()
    return exportTriples(triples, {
      format: options.format ?? 'jsonl',
      includeMetadata: options.includeMetadata,
      pretty: options.pretty,
    })
  }

  /**
   * Import triples from a string format
   * @param data - The data to import
   * @param options - Import options
   * @returns Number of triples imported
   */
  async importData(data: string, options: ImportOptions = {}): Promise<number> {
    const triples = importTriples(data, options)
    
    if (triples.length > 0) {
      await this.batchInsert(triples)
    }
    
    return triples.length
  }

  /**
   * Replace all data with imported triples (clears existing data first)
   * @param data - The data to import
   * @param options - Import options
   * @returns Number of triples imported
   */
  async replaceWithImport(data: string, options: ImportOptions = {}): Promise<number> {
    const triples = importTriples(data, options)
    
    // Clear existing data
    await this.backend.clear()
    
    if (triples.length > 0) {
      await this.backend.batchInsert(triples)
      
      // Record as a single batch operation
      const operation: Operation = { type: 'batch-insert', triples }
      const entry = await this.logManager.recordOperation(operation)
      await this.logManager.pushToUndoStack(entry)
      
      this.events.emit('change', entry)
      await this.maybeAutoCheckpoint()
    }
    
    return triples.length
  }

  // ========== Private Methods ==========

  /**
   * Check and create auto checkpoint if needed
   */
  private async maybeAutoCheckpoint(): Promise<void> {
    const info = await this.checkpointManager.maybeCreateAutoCheckpoint()
    if (info) {
      this.events.emit('snapshot', info)
    }
  }

  /**
   * Apply operation directly without logging
   */
  private async applyOperationDirectly(operation: Operation): Promise<void> {
    switch (operation.type) {
      case 'insert':
        await this.backend.insert(operation.triple)
        break

      case 'delete':
        await this.backend.delete(operation.triple)
        break

      case 'batch-insert':
        await this.backend.batchInsert(operation.triples)
        break

      case 'batch-delete':
        for (const triple of operation.triples) {
          await this.backend.delete(triple)
        }
        break
    }
  }

  /**
   * Rebuild state from a snapshot
   */
  private async rebuildFromSnapshot(ref: SnapshotRef): Promise<void> {
    // For now, we need to replay from the beginning
    // In a full implementation, we would have stored snapshot data
    
    // Get the snapshot info
    const snapshot = await this.logManager.getSnapshot(ref)
    if (!snapshot) {
      throw new Error(`Snapshot not found: ${ref}`)
    }

    // Clear current state
    await this.backend.clear()

    // Get all operations up to the snapshot's log index
    const persistence = this.logManager.getPersistence()
    const records = await persistence.getLogRange(0, snapshot.logIndex)

    // Replay operations
    for (const record of records) {
      if (record.type === 'operation') {
        await this.applyOperationDirectly(record.entry.operation)
      }
    }
  }
}
