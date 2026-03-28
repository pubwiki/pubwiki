/**
 * CopilotSessionStore — Unified IndexedDB-backed persistence for copilot sessions.
 *
 * Manages session metadata and acts as a MessageStoreProvider factory.
 * Each session gets its own IDB-scoped MessageStoreProvider for direct PubChat integration.
 *
 * Replaces both ChatMessageStore and WBNSessionStore.
 */

import type { MessageStoreProvider, MessageNode } from '@pubwiki/chat'
import type { WBNSession } from '@pubwiki/world-editor'
import type { DisplayMessage } from '@pubwiki/svelte-chat'

// ============================================================================
// Types
// ============================================================================

export type SessionMode = 'chat' | 'designer' | 'builder'

/** Full session data (for load/save). */
export interface CopilotSession {
  id: string
  projectId: string
  mode: SessionMode
  title: string
  createdAt: number
  updatedAt: number
  /** PubChat conversation position — needed to restore streaming from where we left off. */
  historyId?: string | null
  /** Builder-only: full WBNSession data. */
  builderSession?: WBNSession
}

/** Lightweight metadata for session list rendering. */
export interface CopilotSessionMeta {
  id: string
  projectId: string
  mode: SessionMode
  title: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

// ============================================================================
// Constants
// ============================================================================

const DB_NAME = 'world-editor-copilot-sessions'
const DB_VERSION = 1
const SESSIONS_STORE = 'sessions'
const MESSAGES_STORE = 'messages'

// ============================================================================
// IDB Helpers
// ============================================================================

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const store = db.createObjectStore(SESSIONS_STORE, { keyPath: 'id' })
        store.createIndex('projectId', 'projectId', { unique: false })
        store.createIndex('projectId_updatedAt', ['projectId', 'updatedAt'], { unique: false })
      }

      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        const store = db.createObjectStore(MESSAGES_STORE, { keyPath: ['sessionId', 'id'] })
        store.createIndex('sessionId', 'sessionId', { unique: false })
        store.createIndex('sessionId_parentId', ['sessionId', 'parentId'], { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Promisified IDB request wrapper. */
function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// ============================================================================
// IdbMessageStore — MessageStoreProvider scoped to a single session
// ============================================================================

interface StoredMessage extends MessageNode {
  sessionId: string
}

class IdbMessageStore implements MessageStoreProvider {
  private cache = new Map<string, MessageNode>()
  private childrenIndex = new Map<string, Set<string>>()
  private loaded = false

  constructor(
    private readonly dbPromise: Promise<IDBDatabase>,
    private readonly sessionId: string,
  ) {}

  /** Eagerly load all messages for this session into memory cache. */
  async warmup(): Promise<void> {
    if (this.loaded) return
    const db = await this.dbPromise
    const tx = db.transaction(MESSAGES_STORE, 'readonly')
    const index = tx.objectStore(MESSAGES_STORE).index('sessionId')
    const all: StoredMessage[] = await idbRequest(index.getAll(this.sessionId))

    for (const msg of all) {
      const node: MessageNode = { ...msg }
      delete (node as any).sessionId
      this.cache.set(node.id, node)
      const parentKey = node.parentId ?? '__ROOT__'
      if (!this.childrenIndex.has(parentKey)) this.childrenIndex.set(parentKey, new Set())
      this.childrenIndex.get(parentKey)!.add(node.id)
    }
    this.loaded = true
  }

  async save(node: MessageNode): Promise<void> {
    // Write to IDB
    const db = await this.dbPromise
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    const stored: StoredMessage = { ...node, sessionId: this.sessionId }
    await idbRequest(tx.objectStore(MESSAGES_STORE).put(stored))

    // Update cache
    this.cache.set(node.id, node)
    const parentKey = node.parentId ?? '__ROOT__'
    if (!this.childrenIndex.has(parentKey)) this.childrenIndex.set(parentKey, new Set())
    this.childrenIndex.get(parentKey)!.add(node.id)
  }

  async saveBatch(nodes: MessageNode[]): Promise<void> {
    const db = await this.dbPromise
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    const store = tx.objectStore(MESSAGES_STORE)
    for (const node of nodes) {
      const stored: StoredMessage = { ...node, sessionId: this.sessionId }
      store.put(stored)
      // Update cache
      this.cache.set(node.id, node)
      const parentKey = node.parentId ?? '__ROOT__'
      if (!this.childrenIndex.has(parentKey)) this.childrenIndex.set(parentKey, new Set())
      this.childrenIndex.get(parentKey)!.add(node.id)
    }
    await idbRequest(tx as unknown as IDBRequest)
  }

  async get(id: string): Promise<MessageNode | null> {
    return this.cache.get(id) ?? null
  }

  async getChildren(parentId: string): Promise<MessageNode[]> {
    const childIds = this.childrenIndex.get(parentId) ?? new Set()
    return Array.from(childIds)
      .map(id => this.cache.get(id)!)
      .filter(Boolean)
      .sort((a, b) => a.timestamp - b.timestamp)
  }

  async getPath(leafId: string): Promise<MessageNode[]> {
    const path: MessageNode[] = []
    let current = await this.get(leafId)
    while (current) {
      path.unshift(current)
      if (!current.parentId) break
      current = await this.get(current.parentId)
    }
    return path
  }

  async delete(id: string, deleteDescendants = true): Promise<void> {
    const toDelete = [id]
    if (deleteDescendants) {
      const collectDescendants = (nodeId: string) => {
        const childIds = this.childrenIndex.get(nodeId)
        if (!childIds) return
        for (const childId of childIds) {
          toDelete.push(childId)
          collectDescendants(childId)
        }
      }
      collectDescendants(id)
    }

    const db = await this.dbPromise
    const tx = db.transaction(MESSAGES_STORE, 'readwrite')
    const store = tx.objectStore(MESSAGES_STORE)
    for (const delId of toDelete) {
      const node = this.cache.get(delId)
      if (node) {
        store.delete([this.sessionId, delId])
        const parentKey = node.parentId ?? '__ROOT__'
        this.childrenIndex.get(parentKey)?.delete(delId)
        this.childrenIndex.delete(delId)
        this.cache.delete(delId)
      }
    }
    await idbRequest(tx as unknown as IDBRequest)
  }

  async listRoots(): Promise<MessageNode[]> {
    const rootIds = this.childrenIndex.get('__ROOT__') ?? new Set()
    return Array.from(rootIds)
      .map(id => this.cache.get(id)!)
      .filter(Boolean)
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  /** Get all cached messages as DisplayMessage[] (for UI rendering). */
  getAllMessages(): DisplayMessage[] {
    return Array.from(this.cache.values())
      .sort((a, b) => a.timestamp - b.timestamp) as DisplayMessage[]
  }

  /** Clear the in-memory cache without touching IDB. */
  clearCache(): void {
    this.cache.clear()
    this.childrenIndex.clear()
    this.loaded = false
  }

  get size(): number {
    return this.cache.size
  }
}

// ============================================================================
// CopilotSessionStore
// ============================================================================

export class CopilotSessionStore {
  private readonly dbPromise: Promise<IDBDatabase>

  constructor() {
    this.dbPromise = openDB()
  }

  // --------------------------------------------------------------------------
  // Session CRUD
  // --------------------------------------------------------------------------

  /** List all sessions for a project (sorted by updatedAt descending). */
  async list(projectId: string): Promise<CopilotSessionMeta[]> {
    const db = await this.dbPromise
    const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], 'readonly')
    const sessionStore = tx.objectStore(SESSIONS_STORE)
    const msgStore = tx.objectStore(MESSAGES_STORE)
    const index = sessionStore.index('projectId')

    const sessions: CopilotSession[] = await idbRequest(index.getAll(projectId))

    // Count messages per session
    const result: CopilotSessionMeta[] = []
    for (const session of sessions) {
      const msgIndex = msgStore.index('sessionId')
      const count = await idbRequest(msgIndex.count(session.id))
      result.push({
        id: session.id,
        projectId: session.projectId,
        mode: session.mode,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: count,
      })
    }

    // Sort by updatedAt descending
    result.sort((a, b) => b.updatedAt - a.updatedAt)
    return result
  }

  /** Load a full session (metadata only — messages are accessed via MessageStoreProvider). */
  async load(sessionId: string): Promise<CopilotSession | null> {
    const db = await this.dbPromise
    const tx = db.transaction(SESSIONS_STORE, 'readonly')
    const result = await idbRequest(tx.objectStore(SESSIONS_STORE).get(sessionId))
    return (result as CopilotSession) ?? null
  }

  /** Save/update session metadata. */
  async save(session: CopilotSession): Promise<void> {
    const db = await this.dbPromise
    const tx = db.transaction(SESSIONS_STORE, 'readwrite')
    await idbRequest(tx.objectStore(SESSIONS_STORE).put(session))
  }

  /** Delete a session and all its messages. */
  async delete(sessionId: string): Promise<void> {
    const db = await this.dbPromise
    const tx = db.transaction([SESSIONS_STORE, MESSAGES_STORE], 'readwrite')

    // Delete session metadata
    tx.objectStore(SESSIONS_STORE).delete(sessionId)

    // Delete all messages for this session
    const msgIndex = tx.objectStore(MESSAGES_STORE).index('sessionId')
    const msgs: StoredMessage[] = await idbRequest(msgIndex.getAll(sessionId))
    const msgStore = tx.objectStore(MESSAGES_STORE)
    for (const msg of msgs) {
      msgStore.delete([msg.sessionId, msg.id])
    }

    await idbRequest(tx as unknown as IDBRequest)
  }

  /** Delete all sessions for a project. */
  async deleteAllForProject(projectId: string): Promise<void> {
    const sessions = await this.list(projectId)
    for (const session of sessions) {
      await this.delete(session.id)
    }
  }

  // --------------------------------------------------------------------------
  // MessageStoreProvider Factory
  // --------------------------------------------------------------------------

  /** Create an IDB-backed MessageStoreProvider for a specific session. */
  createMessageStore(sessionId: string): IdbMessageStore {
    return new IdbMessageStore(this.dbPromise, sessionId)
  }
}

// ============================================================================
// Helpers
// ============================================================================

/** Generate a unique session ID. */
export function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Generate a session title from the first user message. */
export function generateSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim()
  if (trimmed.length <= 30) return trimmed
  return trimmed.slice(0, 27) + '...'
}
