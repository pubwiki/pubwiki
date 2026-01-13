/**
 * Log persistence using abstract-level
 * 
 * Stores operation logs and snapshot metadata in a sublevel,
 * completely isolated from RDF data.
 */

import type { LogEntry, SnapshotRef, StoredSnapshotMeta, LogRecord, LevelInstance } from '../types.js'

/** Sublevel name for log data */
export const LOG_SUBLEVEL = 'log'

// Key prefixes within the log sublevel
const LOG_PREFIX = 'entry:'
const SNAPSHOT_PREFIX = 'snap:'
const META_PREFIX = 'meta:'

/**
 * Level-based persistence for logs and snapshots
 * Uses a sublevel to isolate log data from RDF data
 */
export class LogPersistence {
  private _isOpen = false
  private logLevel: LevelInstance | null = null

  constructor(
    private db: LevelInstance
  ) {}

  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Open the persistence layer
   */
  async open(): Promise<void> {
    if (this._isOpen) return
    // Create a sublevel for log data
    this.logLevel = this.db.sublevel(LOG_SUBLEVEL, { valueEncoding: 'utf8' }) as LevelInstance
    this._isOpen = true
  }

  /**
   * Close the persistence layer
   */
  async close(): Promise<void> {
    if (!this._isOpen) return
    // Don't close the level - it's managed by the store
    this.logLevel = null
    this._isOpen = false
  }

  private ensureOpen(): LevelInstance {
    if (!this._isOpen || !this.logLevel) throw new Error('LogPersistence not open')
    return this.logLevel
  }

  /**
   * Generate a key for log entries (padded for proper ordering)
   */
  private logKey(index: number): string {
    return `${LOG_PREFIX}${index.toString().padStart(12, '0')}`
  }

  /**
   * Generate a key for snapshot metadata
   */
  private snapshotKey(ref: SnapshotRef): string {
    return `${SNAPSHOT_PREFIX}${ref}`
  }

  /**
   * Generate a key for metadata
   */
  private metaKey(key: string): string {
    return `${META_PREFIX}${key}`
  }

  // ========== Log Operations ==========

  /**
   * Append a log entry
   * @returns The index of the appended entry
   */
  async appendLog(entry: LogEntry): Promise<number> {
    const db = this.ensureOpen()
    const index = await this.getLogLength()
    const record: LogRecord = { type: 'operation', entry }
    await db.put(this.logKey(index), JSON.stringify(record))
    await this.setMeta('logLength', index + 1)
    return index
  }

  /**
   * Append a checkpoint record
   */
  async appendCheckpoint(ref: SnapshotRef, logIndex: number): Promise<void> {
    const db = this.ensureOpen()
    const index = await this.getLogLength()
    const record: LogRecord = { 
      type: 'checkpoint', 
      ref, 
      logIndex,
      timestamp: Date.now() 
    }
    await db.put(this.logKey(index), JSON.stringify(record))
    await this.setMeta('logLength', index + 1)
  }

  /**
   * Get a log entry by index
   */
  async getLogEntry(index: number): Promise<LogRecord | null> {
    const db = this.ensureOpen()
    try {
      const value = await db.get(this.logKey(index))
      if (value === undefined) return null
      return JSON.parse(value) as LogRecord
    } catch {
      return null
    }
  }

  /**
   * Get log entries in a range
   */
  async getLogRange(start: number, end?: number): Promise<LogRecord[]> {
    const db = this.ensureOpen()
    const length = await this.getLogLength()
    const actualEnd = end ?? length
    const records: LogRecord[] = []

    for (let i = start; i < actualEnd && i < length; i++) {
      try {
        const value = await db.get(this.logKey(i))
        if (value === undefined) break
        records.push(JSON.parse(value) as LogRecord)
      } catch {
        // Entry doesn't exist
        break
      }
    }

    return records
  }

  /**
   * Get the current log length
   */
  async getLogLength(): Promise<number> {
    return (await this.getMeta<number>('logLength')) ?? 0
  }

  /**
   * Get all operation log entries (excluding checkpoints)
   */
  async getAllOperationEntries(): Promise<LogEntry[]> {
    const records = await this.getLogRange(0)
    return records
      .filter((r): r is { type: 'operation'; entry: LogEntry } => r.type === 'operation')
      .map(r => r.entry)
  }

  // ========== Snapshot Operations ==========

  /**
   * Save snapshot metadata
   */
  async saveSnapshotMeta(meta: StoredSnapshotMeta): Promise<void> {
    const db = this.ensureOpen()
    await db.put(this.snapshotKey(meta.ref), JSON.stringify(meta))
    
    // Also maintain an index of all snapshots
    const index = await this.getSnapshotIndex()
    if (!index.includes(meta.ref)) {
      index.push(meta.ref)
      await this.setMeta('snapshotIndex', index)
    }
  }

  /**
   * Get snapshot metadata by reference
   */
  async getSnapshotMeta(ref: SnapshotRef): Promise<StoredSnapshotMeta | null> {
    const db = this.ensureOpen()
    try {
      const value = await db.get(this.snapshotKey(ref))
      if (value === undefined) return null
      return JSON.parse(value) as StoredSnapshotMeta
    } catch {
      return null
    }
  }

  /**
   * Delete snapshot metadata
   */
  async deleteSnapshotMeta(ref: SnapshotRef): Promise<void> {
    const db = this.ensureOpen()
    try {
      await db.del(this.snapshotKey(ref))
      
      // Remove from index
      const index = await this.getSnapshotIndex()
      const newIndex = index.filter(r => r !== ref)
      await this.setMeta('snapshotIndex', newIndex)
    } catch {
      // Ignore if doesn't exist
    }
  }

  /**
   * Get all snapshot references
   */
  async getSnapshotIndex(): Promise<SnapshotRef[]> {
    return (await this.getMeta<SnapshotRef[]>('snapshotIndex')) ?? []
  }

  /**
   * Get all snapshot metadata
   */
  async getAllSnapshots(): Promise<StoredSnapshotMeta[]> {
    const index = await this.getSnapshotIndex()
    const snapshots: StoredSnapshotMeta[] = []
    
    for (const ref of index) {
      const meta = await this.getSnapshotMeta(ref)
      if (meta) snapshots.push(meta)
    }
    
    return snapshots.sort((a, b) => a.logIndex - b.logIndex)
  }

  // ========== Meta Operations ==========

  /**
   * Set metadata value
   */
  async setMeta<T>(key: string, value: T): Promise<void> {
    const db = this.ensureOpen()
    await db.put(this.metaKey(key), JSON.stringify(value))
  }

  /**
   * Get metadata value
   */
  async getMeta<T>(key: string): Promise<T | null> {
    const db = this.ensureOpen()
    try {
      const value = await db.get(this.metaKey(key))
      if (value === undefined) return null
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }

  /**
   * Get the current snapshot reference
   */
  async getCurrentRef(): Promise<SnapshotRef | null> {
    return this.getMeta<SnapshotRef>('currentRef')
  }

  /**
   * Set the current snapshot reference
   */
  async setCurrentRef(ref: SnapshotRef): Promise<void> {
    await this.setMeta('currentRef', ref)
  }

  // ========== Undo/Redo Stack ==========

  /**
   * Get the undo stack
   */
  async getUndoStack(): Promise<LogEntry[]> {
    return (await this.getMeta<LogEntry[]>('undoStack')) ?? []
  }

  /**
   * Set the undo stack
   */
  async setUndoStack(stack: LogEntry[]): Promise<void> {
    await this.setMeta('undoStack', stack)
  }

  /**
   * Get the redo stack
   */
  async getRedoStack(): Promise<LogEntry[]> {
    return (await this.getMeta<LogEntry[]>('redoStack')) ?? []
  }

  /**
   * Set the redo stack
   */
  async setRedoStack(stack: LogEntry[]): Promise<void> {
    await this.setMeta('redoStack', stack)
  }

  /**
   * Clear the redo stack
   */
  async clearRedoStack(): Promise<void> {
    await this.setMeta('redoStack', [])
  }

  // ========== Clear Operations ==========

  /**
   * Clear all logs (keep snapshots)
   */
  async clearLogs(): Promise<void> {
    const db = this.ensureOpen()
    const length = await this.getLogLength()
    
    for (let i = 0; i < length; i++) {
      try {
        await db.del(this.logKey(i))
      } catch {
        // Ignore errors
      }
    }
    
    await this.setMeta('logLength', 0)
  }

  /**
   * Clear everything
   */
  async clearAll(): Promise<void> {
    await this.clearLogs()
    
    const db = this.ensureOpen()
    const index = await this.getSnapshotIndex()
    
    for (const ref of index) {
      try {
        await db.del(this.snapshotKey(ref))
      } catch {
        // Ignore errors
      }
    }
    
    await this.setMeta('snapshotIndex', [])
    await this.setMeta('currentRef', null)
    await this.setMeta('undoStack', [])
    await this.setMeta('redoStack', [])
  }
}

/**
 * Create and open a LogPersistence instance
 */
export async function createLogPersistence(
  level: LevelInstance
): Promise<LogPersistence> {
  const persistence = new LogPersistence(level)
  await persistence.open()
  return persistence
}