/**
 * Sprite Store — 角色立绘持久化存储
 *
 * IndexedDB (`galgame-sprites`) + 内存 Map 缓存。
 * 复合键: `${creatureId}__${expression}` → dataUrl
 */

import { create } from 'zustand'
import type { GalExpression } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface SpriteRecord {
  key: string           // `${creatureId}__${expression}`
  creatureId: string
  expression: GalExpression
  dataUrl: string
  mimeType: string
  updatedAt: number
}

export interface SpriteExportData {
  version: 1
  sprites: Array<{
    creatureId: string
    expression: GalExpression
    dataUrl: string
    mimeType: string
  }>
}

// ============================================================================
// IndexedDB helpers
// ============================================================================

const DB_NAME = 'galgame-sprites'
const DB_VERSION = 1
const STORE_NAME = 'sprites'

function openSpriteDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' })
      }
    }
  })
}

function idbPut(record: SpriteRecord): void {
  openSpriteDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
  }).catch(e => console.error('Sprite IDB put:', e))
}

function idbDelete(key: string): void {
  openSpriteDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
  }).catch(e => console.error('Sprite IDB delete:', e))
}

function idbClear(): void {
  openSpriteDB().then(db => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
  }).catch(e => console.error('Sprite IDB clear:', e))
}

async function idbGetAll(): Promise<SpriteRecord[]> {
  const db = await openSpriteDB()
  const tx = db.transaction(STORE_NAME, 'readonly')
  const request = tx.objectStore(STORE_NAME).getAll()
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as SpriteRecord[])
    request.onerror = () => reject(request.error)
  })
}

// ============================================================================
// Key helper
// ============================================================================

function makeKey(creatureId: string, expression: GalExpression): string {
  return `${creatureId}__${expression}`
}

// ============================================================================
// Zustand Store
// ============================================================================

interface SpriteState {
  /** creatureId__expression → dataUrl */
  sprites: Map<string, string>
  initialized: boolean

  initSprites: () => Promise<void>
  getSpriteUrl: (creatureId: string, expression?: GalExpression) => string | null
  setSprite: (creatureId: string, expression: GalExpression, dataUrl: string, mimeType: string) => void
  removeSprite: (creatureId: string, expression: GalExpression) => void
  removeCreatureSprites: (creatureId: string) => void
  clearAll: () => void
  exportSprites: () => Promise<SpriteExportData>
  importSprites: (data: SpriteExportData) => Promise<number>
  hasAnySprite: (creatureId: string) => boolean
}

export const useSpriteStore = create<SpriteState>((set, get) => ({
  sprites: new Map(),
  initialized: false,

  initSprites: async () => {
    if (get().initialized) return
    try {
      const records = await idbGetAll()
      const map = new Map<string, string>()
      for (const r of records) {
        map.set(r.key, r.dataUrl)
      }
      set({ sprites: map, initialized: true })
    } catch (e) {
      console.error('Failed to init sprites from IDB:', e)
      set({ initialized: true })
    }
  },

  getSpriteUrl: (creatureId, expression) => {
    const { sprites } = get()
    if (!creatureId) return null
    const expr = expression || 'normal'
    // Exact match
    const exactKey = makeKey(creatureId, expr)
    if (sprites.has(exactKey)) return sprites.get(exactKey)!
    // Fallback to normal
    if (expr !== 'normal') {
      const normalKey = makeKey(creatureId, 'normal')
      if (sprites.has(normalKey)) return sprites.get(normalKey)!
    }
    return null
  },

  setSprite: (creatureId, expression, dataUrl, mimeType) => {
    const key = makeKey(creatureId, expression)
    set(state => {
      const newMap = new Map(state.sprites)
      newMap.set(key, dataUrl)
      return { sprites: newMap }
    })
    idbPut({ key, creatureId, expression, dataUrl, mimeType, updatedAt: Date.now() })
  },

  removeSprite: (creatureId, expression) => {
    const key = makeKey(creatureId, expression)
    set(state => {
      const newMap = new Map(state.sprites)
      newMap.delete(key)
      return { sprites: newMap }
    })
    idbDelete(key)
  },

  removeCreatureSprites: (creatureId) => {
    const prefix = `${creatureId}__`
    set(state => {
      const newMap = new Map(state.sprites)
      for (const k of Array.from(newMap.keys())) {
        if (k.startsWith(prefix)) {
          newMap.delete(k)
          idbDelete(k)
        }
      }
      return { sprites: newMap }
    })
  },

  clearAll: () => {
    set({ sprites: new Map() })
    idbClear()
  },

  exportSprites: async () => {
    const records = await idbGetAll()
    return {
      version: 1 as const,
      sprites: records.map(r => ({
        creatureId: r.creatureId,
        expression: r.expression,
        dataUrl: r.dataUrl,
        mimeType: r.mimeType,
      }))
    }
  },

  importSprites: async (data) => {
    if (data.version !== 1) throw new Error('Unsupported sprite export version')
    let count = 0
    const { setSprite } = get()
    for (const s of data.sprites) {
      setSprite(s.creatureId, s.expression, s.dataUrl, s.mimeType)
      count++
    }
    return count
  },

  hasAnySprite: (creatureId) => {
    const prefix = `${creatureId}__`
    for (const k of get().sprites.keys()) {
      if (k.startsWith(prefix)) return true
    }
    return false
  },
}))
