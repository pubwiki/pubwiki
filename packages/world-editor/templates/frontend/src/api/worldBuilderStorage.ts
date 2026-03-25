/**
 * World Builder Session Storage — IndexedDB-backed with in-memory cache
 * 
 * Provides synchronous read/write API via an in-memory Map cache,
 * with asynchronous persistence to IndexedDB (virtually unlimited storage).
 * This replaces localStorage which has a ~5MB limit and can't hold
 * full chat histories.
 */

/** Generic session record — works for both v1 and v2 world builder sessions */
interface StoredSession {
    id: string
    updatedAt: number
    [key: string]: unknown
}

const DB_NAME = 'world-builder'
const DB_VERSION = 1
const STORE_NAME = 'sessions'

// ============================================================================
// In-Memory Cache (synchronous access layer)
// ============================================================================

/** In-memory session map for synchronous reads */
const sessionCache = new Map<string, StoredSession>()
let cacheInitialized = false
let dbInstance: IDBDatabase | null = null

// ============================================================================
// IndexedDB Helpers
// ============================================================================

function openDB(): Promise<IDBDatabase> {
    if (dbInstance) return Promise.resolve(dbInstance)

    return new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onupgradeneeded = () => {
            const db = request.result
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' })
            }
        }

        request.onsuccess = () => {
            dbInstance = request.result
            resolve(dbInstance)
        }

        request.onerror = () => {
            console.error('[WB Storage] Failed to open IndexedDB:', request.error)
            reject(request.error)
        }
    })
}

/** Load all sessions from IndexedDB into the in-memory cache */
async function loadFromDB(): Promise<void> {
    if (cacheInitialized) return

    try {
        const db = await openDB()
        const tx = db.transaction(STORE_NAME, 'readonly')
        const store = tx.objectStore(STORE_NAME)

        const sessions = await new Promise<StoredSession[]>((resolve, reject) => {
            const request = store.getAll()
            request.onsuccess = () => resolve(request.result || [])
            request.onerror = () => reject(request.error)
        })

        for (const s of sessions) {
            sessionCache.set(s.id, s)
        }
        cacheInitialized = true
    } catch (e) {
        console.error('[WB Storage] Failed to load from IndexedDB:', e)
        // Fall back to localStorage migration
        migrateFromLocalStorage()
        cacheInitialized = true
    }
}

/** Persist a single session to IndexedDB (fire-and-forget) */
function persistToDB(session: StoredSession): void {
    openDB().then(db => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.put(session)
    }).catch(e => {
        console.error('[WB Storage] Failed to persist session:', e)
    })
}

/** Delete a session from IndexedDB (fire-and-forget) */
function deleteFromDB(sessionId: string): void {
    openDB().then(db => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        const store = tx.objectStore(STORE_NAME)
        store.delete(sessionId)
    }).catch(e => {
        console.error('[WB Storage] Failed to delete session:', e)
    })
}

// ============================================================================
// Migration from localStorage
// ============================================================================

const LEGACY_SESSIONS_KEY = 'world-builder-sessions'

function migrateFromLocalStorage(): void {
    try {
        const raw = localStorage.getItem(LEGACY_SESSIONS_KEY)
        if (!raw) return

        const sessions: StoredSession[] = JSON.parse(raw)
        for (const s of sessions) {
            sessionCache.set(s.id, s)
            persistToDB(s)
        }

        // Clean up localStorage after migration
        localStorage.removeItem(LEGACY_SESSIONS_KEY)
        console.log(`[WB Storage] Migrated ${sessions.length} sessions from localStorage to IndexedDB`)
    } catch (e) {
        console.error('[WB Storage] localStorage migration failed:', e)
    }
}

// ============================================================================
// Public API (synchronous — reads from cache, writes through to IndexedDB)
// ============================================================================

/**
 * Initialize the storage. Call once at app startup.
 * Until this resolves, reads return empty results (safe for UI).
 */
export async function initSessionStorage(): Promise<void> {
    await loadFromDB()
}

export function loadSessions(): StoredSession[] {
    return Array.from(sessionCache.values())
}

export function saveSession(session: StoredSession): void {
    session.updatedAt = Date.now()
    sessionCache.set(session.id, session)
    persistToDB(session)
}

export function deleteSession(sessionId: string): void {
    sessionCache.delete(sessionId)
    deleteFromDB(sessionId)
}

export function getSession(sessionId: string): StoredSession | null {
    return sessionCache.get(sessionId) || null
}
