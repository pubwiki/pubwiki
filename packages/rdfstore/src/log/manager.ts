/**
 * Log Manager
 * 
 * Manages the write-ahead log for RDF operations
 */

import type { 
  LogEntry, 
  Operation, 
  SnapshotRef, 
  SnapshotInfo, 
  StoredSnapshotMeta,
  HistoryOptions,
  LevelInstance
} from '../types.js'
import { LogPersistence } from './persistence.js'
import { generateId, generateCheckpointRef } from '../utils/hash.js'

export class LogManager {
  private persistence: LogPersistence
  private _currentRef: SnapshotRef = 'empty'
  private operationsSinceCheckpoint = 0

  constructor(
    level: LevelInstance,
    private autoCheckpointInterval: number = 100,
    private enableAutoCheckpoint: boolean = true
  ) {
    this.persistence = new LogPersistence(level)
  }

  get currentRef(): SnapshotRef {
    return this._currentRef
  }

  /**
   * Open the log manager
   */
  async open(): Promise<void> {
    await this.persistence.open()
    
    // Restore current ref from persistence
    const savedRef = await this.persistence.getCurrentRef()
    if (savedRef) {
      this._currentRef = savedRef
    }
  }

  /**
   * Close the log manager
   */
  async close(): Promise<void> {
    await this.persistence.close()
  }

  /**
   * Record an operation
   */
  async recordOperation(operation: Operation): Promise<LogEntry> {
    const entry: LogEntry = {
      id: generateId(),
      timestamp: Date.now(),
      operation,
      prevRef: this._currentRef,
    }

    // Append to log
    const logIndex = await this.persistence.appendLog(entry)

    // Generate new snapshot ref
    this._currentRef = `op-${logIndex}-${entry.id}`
    await this.persistence.setCurrentRef(this._currentRef)

    // Clear redo stack on new operation
    await this.persistence.clearRedoStack()

    // Check if we need to trigger auto checkpoint
    this.operationsSinceCheckpoint++
    if (this.enableAutoCheckpoint && this.operationsSinceCheckpoint >= this.autoCheckpointInterval) {
      // Return entry, checkpoint will be handled by the caller
    }

    return entry
  }

  /**
   * Check if auto checkpoint is needed
   */
  shouldAutoCheckpoint(): boolean {
    return this.enableAutoCheckpoint && this.operationsSinceCheckpoint >= this.autoCheckpointInterval
  }

  /**
   * Reset checkpoint counter (called after checkpoint)
   */
  resetCheckpointCounter(): void {
    this.operationsSinceCheckpoint = 0
  }

  /**
   * Save a snapshot checkpoint
   */
  async saveCheckpoint(
    tripleCount: number,
    label?: string,
    isAutoCheckpoint: boolean = false
  ): Promise<SnapshotInfo> {
    const logIndex = await this.persistence.getLogLength()
    const ref = generateCheckpointRef(logIndex)
    const timestamp = Date.now()

    const meta: StoredSnapshotMeta = {
      ref,
      timestamp,
      tripleCount,
      logIndex,
      label,
      isAutoCheckpoint,
    }

    await this.persistence.saveSnapshotMeta(meta)
    await this.persistence.appendCheckpoint(ref, logIndex)

    // Update current ref to checkpoint
    this._currentRef = ref
    await this.persistence.setCurrentRef(this._currentRef)
    
    this.operationsSinceCheckpoint = 0

    return {
      ref,
      timestamp,
      tripleCount,
      logIndex,
      label,
      isAutoCheckpoint,
    }
  }

  /**
   * List all saved snapshots
   */
  async listSnapshots(): Promise<SnapshotInfo[]> {
    const metas = await this.persistence.getAllSnapshots()
    return metas.map(m => ({
      ref: m.ref,
      timestamp: m.timestamp,
      tripleCount: m.tripleCount,
      logIndex: m.logIndex,
      label: m.label,
      isAutoCheckpoint: m.isAutoCheckpoint,
    }))
  }

  /**
   * Get a specific snapshot
   */
  async getSnapshot(ref: SnapshotRef): Promise<SnapshotInfo | null> {
    const meta = await this.persistence.getSnapshotMeta(ref)
    if (!meta) return null
    
    return {
      ref: meta.ref,
      timestamp: meta.timestamp,
      tripleCount: meta.tripleCount,
      logIndex: meta.logIndex,
      label: meta.label,
      isAutoCheckpoint: meta.isAutoCheckpoint,
    }
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(ref: SnapshotRef): Promise<void> {
    await this.persistence.deleteSnapshotMeta(ref)
  }

  /**
   * Get operation history
   */
  async getHistory(options: HistoryOptions = {}): Promise<LogEntry[]> {
    const records = await this.persistence.getAllOperationEntries()
    let entries = records

    // Filter by since
    if (options.since) {
      const sinceIdx = entries.findIndex(e => e.prevRef === options.since || e.id.includes(options.since!))
      if (sinceIdx > 0) {
        entries = entries.slice(sinceIdx)
      }
    }

    // Filter by until
    if (options.until) {
      const untilIdx = entries.findIndex(e => e.id.includes(options.until!))
      if (untilIdx >= 0) {
        entries = entries.slice(0, untilIdx + 1)
      }
    }

    // Apply limit
    if (options.limit) {
      entries = entries.slice(-options.limit)
    }

    return entries
  }

  /**
   * Get operations since a snapshot
   */
  async getOperationsSince(ref: SnapshotRef): Promise<LogEntry[]> {
    const allRecords = await this.persistence.getLogRange(0)
    const entries: LogEntry[] = []
    let found = false

    for (const record of allRecords) {
      if (record.type === 'checkpoint' && record.ref === ref) {
        found = true
        continue
      }
      if (found && record.type === 'operation') {
        entries.push(record.entry)
      }
    }

    // If ref not found, might be an operation ref
    if (!found) {
      const opRecords = allRecords.filter((r): r is { type: 'operation'; entry: LogEntry } => r.type === 'operation')
      const refIdx = opRecords.findIndex(r => r.entry.prevRef === ref || `op-${opRecords.indexOf(r)}-${r.entry.id}` === ref)
      if (refIdx >= 0) {
        return opRecords.slice(refIdx + 1).map(r => r.entry)
      }
    }

    return entries
  }

  /**
   * Get the nearest checkpoint before or at a given ref
   */
  async getNearestCheckpoint(ref: SnapshotRef): Promise<{ ref: SnapshotRef; logIndex: number } | null> {
    const snapshots = await this.persistence.getAllSnapshots()
    
    // Check if ref is itself a checkpoint
    const checkpoint = snapshots.find(s => s.ref === ref)
    if (checkpoint) {
      return { ref: checkpoint.ref, logIndex: checkpoint.logIndex }
    }

    // Find the nearest checkpoint before this ref
    // Parse logIndex from ref if possible
    const match = ref.match(/^op-(\d+)-/)
    if (match) {
      const opLogIndex = parseInt(match[1], 10)
      const nearest = snapshots
        .filter(s => s.logIndex <= opLogIndex)
        .sort((a, b) => b.logIndex - a.logIndex)[0]
      
      if (nearest) {
        return { ref: nearest.ref, logIndex: nearest.logIndex }
      }
    }

    // Return the most recent checkpoint
    if (snapshots.length > 0) {
      const latest = snapshots.sort((a, b) => b.logIndex - a.logIndex)[0]
      return { ref: latest.ref, logIndex: latest.logIndex }
    }

    return null
  }

  /**
   * Set current ref (for rollback)
   */
  async setCurrentRef(ref: SnapshotRef): Promise<void> {
    this._currentRef = ref
    await this.persistence.setCurrentRef(ref)
  }

  // ========== Undo/Redo ==========

  /**
   * Push operation to undo stack
   */
  async pushToUndoStack(entry: LogEntry): Promise<void> {
    const stack = await this.persistence.getUndoStack()
    stack.push(entry)
    await this.persistence.setUndoStack(stack)
  }

  /**
   * Pop from undo stack
   */
  async popFromUndoStack(): Promise<LogEntry | undefined> {
    const stack = await this.persistence.getUndoStack()
    const entry = stack.pop()
    await this.persistence.setUndoStack(stack)
    return entry
  }

  /**
   * Push to redo stack
   */
  async pushToRedoStack(entry: LogEntry): Promise<void> {
    const stack = await this.persistence.getRedoStack()
    stack.push(entry)
    await this.persistence.setRedoStack(stack)
  }

  /**
   * Pop from redo stack
   */
  async popFromRedoStack(): Promise<LogEntry | undefined> {
    const stack = await this.persistence.getRedoStack()
    const entry = stack.pop()
    await this.persistence.setRedoStack(stack)
    return entry
  }

  /**
   * Get undo stack length
   */
  async getUndoStackLength(): Promise<number> {
    const stack = await this.persistence.getUndoStack()
    return stack.length
  }

  /**
   * Get redo stack length
   */
  async getRedoStackLength(): Promise<number> {
    const stack = await this.persistence.getRedoStack()
    return stack.length
  }

  /**
   * Clear logs and snapshots (for compaction)
   */
  async clearHistory(): Promise<void> {
    await this.persistence.clearLogs()
  }

  /**
   * Get the underlying persistence layer (for advanced operations)
   */
  getPersistence(): LogPersistence {
    return this.persistence
  }
}

/**
 * Create and open a LogManager
 */
export async function createLogManager(
  level: LevelInstance,
  autoCheckpointInterval?: number,
  enableAutoCheckpoint?: boolean
): Promise<LogManager> {
  const manager = new LogManager(level, autoCheckpointInterval, enableAutoCheckpoint)
  await manager.open()
  return manager
}