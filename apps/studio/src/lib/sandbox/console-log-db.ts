/**
 * Console Log Persistence
 *
 * Provides IndexedDB-backed persistence for sandbox console logs using Dexie.
 * Each sandbox session gets a unique log bucket identified by a session ID.
 * Logs are debounced before persisting to reduce write pressure.
 */

import Dexie, { type EntityTable } from 'dexie'
import type { ConsoleLogEntry } from '@pubwiki/sandbox-host'

/** Console log level (matches ConsoleLogEntry['level']) */
type ConsoleLogLevel = ConsoleLogEntry['level']

// ============================================================================
// Database Types
// ============================================================================

/** Stored log session (bucket) */
export interface StoredLogSession {
  /** Unique session ID */
  id: string
  /** Project ID this session belongs to */
  projectId: string
  /** Human-readable session name */
  name: string
  /** Creation timestamp */
  createdAt: number
  /** Total log count (maintained for quick access) */
  logCount: number
}

/** Stored log entry within a session */
export interface StoredLogEntry {
  /** Auto-incremented primary key */
  id?: number
  /** Session ID this log belongs to */
  sessionId: string
  /** Log level */
  level: ConsoleLogLevel
  /** Timestamp when log was created */
  timestamp: number
  /** Log message */
  message: string
  /** Stack trace (for errors) */
  stack?: string
}

// ============================================================================
// Database Definition
// ============================================================================

class ConsoleLogDatabase extends Dexie {
  sessions!: EntityTable<StoredLogSession, 'id'>
  entries!: EntityTable<StoredLogEntry, 'id'>

  constructor() {
    super('SandboxConsoleLogs')
    this.version(1).stores({
      sessions: 'id, createdAt',
      entries: '++id, sessionId, timestamp, [sessionId+timestamp]'
    })
    this.version(2).stores({
      sessions: 'id, projectId, createdAt',
      entries: '++id, sessionId, timestamp, [sessionId+timestamp]'
    })
  }
}

/** Singleton database instance */
const logDb = new ConsoleLogDatabase()

// ============================================================================
// Session Management
// ============================================================================

/**
 * Create a new log session (bucket).
 * Returns the session ID.
 */
export async function createLogSession(name: string, projectId: string): Promise<string> {
  const id = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const session: StoredLogSession = {
    id,
    projectId,
    name,
    createdAt: Date.now(),
    logCount: 0
  }
  await logDb.sessions.add(session)
  return id
}

/**
 * List all log sessions, most recent first.
 */
export async function listLogSessions(projectId: string): Promise<StoredLogSession[]> {
  return logDb.sessions.where('projectId').equals(projectId).reverse().sortBy('createdAt')
}

/**
 * Delete a log session and all its entries.
 */
export async function deleteLogSession(sessionId: string): Promise<void> {
  await logDb.transaction('rw', [logDb.sessions, logDb.entries], async () => {
    await logDb.entries.where('sessionId').equals(sessionId).delete()
    await logDb.sessions.delete(sessionId)
  })
}

/**
 * Delete all log sessions and their entries.
 */
export async function deleteAllLogSessions(projectId: string): Promise<void> {
  const sessionIds = await logDb.sessions
    .where('projectId').equals(projectId)
    .primaryKeys()
  if (sessionIds.length === 0) return
  await logDb.transaction('rw', [logDb.sessions, logDb.entries], async () => {
    for (const sid of sessionIds) {
      await logDb.entries.where('sessionId').equals(sid).delete()
    }
    await logDb.sessions.bulkDelete(sessionIds)
  })
}

/**
 * Delete all sessions older than the given age (in milliseconds).
 * Default: 7 days.
 */
export async function pruneOldSessions(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - maxAgeMs
  const oldSessions = await logDb.sessions.where('createdAt').below(cutoff).toArray()
  if (oldSessions.length === 0) return 0

  await logDb.transaction('rw', [logDb.sessions, logDb.entries], async () => {
    for (const session of oldSessions) {
      await logDb.entries.where('sessionId').equals(session.id).delete()
    }
    await logDb.sessions.where('createdAt').below(cutoff).delete()
  })
  return oldSessions.length
}

// ============================================================================
// Log Entry Operations
// ============================================================================

/**
 * Persist a batch of log entries for a session.
 */
export async function persistLogEntries(
  sessionId: string,
  entries: ConsoleLogEntry[]
): Promise<void> {
  if (entries.length === 0) return

  const stored: StoredLogEntry[] = entries.map((e) => ({
    sessionId,
    level: e.level,
    timestamp: e.timestamp,
    message: e.message,
    stack: e.stack
  }))

  await logDb.transaction('rw', [logDb.entries, logDb.sessions], async () => {
    await logDb.entries.bulkAdd(stored)
    // Update session log count
    const session = await logDb.sessions.get(sessionId)
    if (session) {
      await logDb.sessions.update(sessionId, {
        logCount: session.logCount + entries.length
      })
    }
  })
}

/**
 * Get log entries for a session, ordered by timestamp.
 * Supports pagination via offset/limit for virtual scrolling.
 */
export async function getLogEntries(
  sessionId: string,
  offset: number = 0,
  limit: number = 100
): Promise<StoredLogEntry[]> {
  return logDb.entries
    .where('[sessionId+timestamp]')
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .offset(offset)
    .limit(limit)
    .toArray()
}

/**
 * Get the total log entry count for a session.
 */
export async function getLogEntryCount(sessionId: string): Promise<number> {
  return logDb.entries.where('sessionId').equals(sessionId).count()
}

/**
 * Clear all log entries for a session.
 */
export async function clearLogEntries(sessionId: string): Promise<void> {
  await logDb.transaction('rw', [logDb.entries, logDb.sessions], async () => {
    await logDb.entries.where('sessionId').equals(sessionId).delete()
    await logDb.sessions.update(sessionId, { logCount: 0 })
  })
}

// ============================================================================
// ConsoleLogStore - Reactive Buffered Store
// ============================================================================

const DEFAULT_DEBOUNCE_MS = 500
const DEFAULT_MAX_BUFFER = 200

/**
 * ConsoleLogStore manages in-memory logs with debounced persistence.
 *
 * Usage:
 *   const store = new ConsoleLogStore(sessionId)
 *   store.push(entry) // called on each incoming log
 *   // logs are persisted after debounce interval
 *   store.dispose()   // flush remaining and cleanup
 */
export class ConsoleLogStore {
  /** Session ID for this store */
  readonly sessionId: string

  /** In-memory buffer of logs not yet persisted */
  private pendingBuffer: ConsoleLogEntry[] = []
  
  /** All in-memory logs (for reactive display) */
  private _logs: ConsoleLogEntry[] = []

  /** Debounce timer handle */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  /** Debounce delay in ms */
  private readonly debounceMs: number

  /** Max pending buffer size before forced flush */
  private readonly maxBuffer: number

  /** Error and warning counts */
  private _errorCount = 0
  private _warnCount = 0

  /** Whether the store has been disposed */
  private disposed = false

  constructor(
    sessionId: string,
    options?: { debounceMs?: number; maxBuffer?: number }
  ) {
    this.sessionId = sessionId
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER
  }

  /** Get all in-memory logs (read-only) */
  get logs(): readonly ConsoleLogEntry[] {
    return this._logs
  }

  /** Get error count */
  get errorCount(): number {
    return this._errorCount
  }

  /** Get warning count */
  get warnCount(): number {
    return this._warnCount
  }

  /** Total number of logs in memory */
  get length(): number {
    return this._logs.length
  }

  /**
   * Push a new log entry. Schedules debounced persistence.
   * Returns the entry for chaining.
   */
  push(entry: ConsoleLogEntry): ConsoleLogEntry {
    if (this.disposed) return entry

    this._logs.push(entry)
    this.pendingBuffer.push(entry)

    if (entry.level === 'error') this._errorCount++
    if (entry.level === 'warn') this._warnCount++

    // Force flush if buffer too large
    if (this.pendingBuffer.length >= this.maxBuffer) {
      this.flush()
    } else {
      this.schedulePersist()
    }

    return entry
  }

  /**
   * Clear all logs (in-memory + persisted).
   */
  async clear(): Promise<void> {
    this.cancelPersist()
    this.pendingBuffer = []
    this._logs = []
    this._errorCount = 0
    this._warnCount = 0
    await clearLogEntries(this.sessionId)
  }

  /**
   * Flush pending buffer to IndexedDB immediately.
   */
  async flush(): Promise<void> {
    this.cancelPersist()
    if (this.pendingBuffer.length === 0) return

    const toFlush = this.pendingBuffer
    this.pendingBuffer = []

    try {
      await persistLogEntries(this.sessionId, toFlush)
    } catch (err) {
      console.error('[ConsoleLogStore] Failed to persist logs:', err)
    }
  }

  /**
   * Load persisted logs from a session into memory.
   * Used when restoring a previous session.
   */
  async loadFromSession(sessionId: string): Promise<void> {
    const count = await getLogEntryCount(sessionId)
    const entries = await getLogEntries(sessionId, 0, count)
    
    for (const entry of entries) {
      const logEntry: ConsoleLogEntry = {
        level: entry.level,
        timestamp: entry.timestamp,
        message: entry.message,
        stack: entry.stack
      }
      this._logs.push(logEntry)
      if (entry.level === 'error') this._errorCount++
      if (entry.level === 'warn') this._warnCount++
    }
  }

  /**
   * Dispose: flush remaining logs and cleanup timers.
   */
  async dispose(): Promise<void> {
    this.disposed = true
    await this.flush()
  }

  // ---- Internal ----

  private schedulePersist(): void {
    if (this.debounceTimer !== null) return
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.flush()
    }, this.debounceMs)
  }

  private cancelPersist(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
  }
}

// ============================================================================
// Log Formatting Utilities
// ============================================================================

/**
 * Format a single log entry as a human-readable line.
 */
export function formatLogEntry(entry: { level: string; timestamp: number; message: string; stack?: string }): string {
  const ts = new Date(entry.timestamp).toISOString()
  const lvl = entry.level.toUpperCase().padEnd(5)
  let line = `[${ts}] ${lvl} ${entry.message}`
  if (entry.stack) {
    line += '\n' + entry.stack.split('\n').map((s) => '  ' + s).join('\n')
  }
  return line
}

/**
 * Format an array of log entries as a complete .log file string.
 */
export function formatLogFile(entries: { level: string; timestamp: number; message: string; stack?: string }[]): string {
  if (entries.length === 0) return ''
  return entries.map(formatLogEntry).join('\n') + '\n'
}

/**
 * Load all entries for a session and return formatted log text.
 */
export async function getFormattedSessionLogs(sessionId: string): Promise<string> {
  const count = await getLogEntryCount(sessionId)
  const entries = await getLogEntries(sessionId, 0, count)
  return formatLogFile(entries)
}

/**
 * Download a session's logs as a .log file.
 */
export function downloadLogFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ============================================================================
// Auto-prune on module load
// ============================================================================

// Prune sessions older than 7 days in the background
pruneOldSessions().then((count) => {
  if (count > 0) {
    console.log(`[ConsoleLogDB] Pruned ${count} old log sessions`)
  }
}).catch(() => { /* silently ignore */ })
