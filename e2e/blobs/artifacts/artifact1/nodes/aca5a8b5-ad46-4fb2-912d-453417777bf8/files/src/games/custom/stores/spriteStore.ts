/**
 * Sprite Store — 角色图像持久化存储
 *
 * IndexedDB (`galgame-sprites`) + 内存 Map 缓存。
 *
 * 两类图像：
 * - standing: 立绘（场景中展示，全身/半身）
 * - avatar:   表情头像（对话框中展示）
 *
 * 复合键: `${creatureId}__${imageType}__${expression}` → dataUrl
 */

import { create } from 'zustand'
import type { GalExpression } from '../types'

// ============================================================================
// Types
// ============================================================================

export type SpriteImageType = 'standing' | 'avatar'

export interface SpriteExportData {
  version: 2
  sprites: Array<{
    creatureId: string
    imageType: SpriteImageType
    expression: GalExpression
    dataUrl: string
    mimeType: string
  }>
}

export interface SpriteRecord {
  key: string
  creatureId: string
  imageType: SpriteImageType
  expression: GalExpression
  dataUrl: string
  mimeType: string
  updatedAt: number
}

// ============================================================================
// IndexedDB helpers
// ============================================================================

const DB_NAME = 'galgame-sprites'
const DB_VERSION = 2
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

function makeKey(creatureId: string, imageType: SpriteImageType, expression: GalExpression): string {
  return `${creatureId}__${imageType}__${expression}`
}

// ============================================================================
// Zustand Store
// ============================================================================

interface SpriteState {
  /** key → dataUrl */
  sprites: Map<string, string>
  initialized: boolean

  initSprites: () => Promise<void>

  /** 获取表情头像 URL（fallback 到 normal） */
  getAvatarUrl: (creatureId: string, expression?: GalExpression) => string | null

  /** 获取立绘 URL（fallback 到 normal） */
  getStandingUrl: (creatureId: string, expression?: GalExpression) => string | null

  /** 兼容旧接口：优先返回头像，无则返回立绘 */
  getSpriteUrl: (creatureId: string, expression?: GalExpression) => string | null

  /** 设置图像 */
  setSprite: (creatureId: string, imageType: SpriteImageType, expression: GalExpression, dataUrl: string, mimeType: string) => void

  /** 删除某个图像 */
  removeSprite: (creatureId: string, imageType: SpriteImageType, expression: GalExpression) => void

  /** 删除某角色的所有图像 */
  removeCreatureSprites: (creatureId: string) => void

  /** 清空全部 */
  clearAll: () => void

  /** 某角色是否有任何图像 */
  hasAnySprite: (creatureId: string) => boolean

  /** 某角色是否有立绘 */
  hasStanding: (creatureId: string) => boolean

  /** 获取某角色所有已配置的表情列表 */
  getCreatureExpressions: (creatureId: string, imageType: SpriteImageType) => GalExpression[]

  /** 获取所有有图像的 creatureId 列表 */
  getAllCreatureIds: () => string[]

  /** 导出所有图像为 JSON */
  exportAll: () => Promise<SpriteExportData>

  /** 导入图像（合并到现有数据） */
  importAll: (data: SpriteExportData) => Promise<number>
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

  getAvatarUrl: (creatureId, expression) => {
    const { sprites } = get()
    if (!creatureId) return null
    const expr = expression || 'normal'
    const key = makeKey(creatureId, 'avatar', expr)
    if (sprites.has(key)) return sprites.get(key)!
    if (expr !== 'normal') {
      const normalKey = makeKey(creatureId, 'avatar', 'normal')
      if (sprites.has(normalKey)) return sprites.get(normalKey)!
    }
    return null
  },

  getStandingUrl: (creatureId, expression) => {
    const { sprites } = get()
    if (!creatureId) return null
    const expr = expression || 'normal'
    const key = makeKey(creatureId, 'standing', expr)
    if (sprites.has(key)) return sprites.get(key)!
    if (expr !== 'normal') {
      const normalKey = makeKey(creatureId, 'standing', 'normal')
      if (sprites.has(normalKey)) return sprites.get(normalKey)!
    }
    return null
  },

  getSpriteUrl: (creatureId, expression) => {
    const { getAvatarUrl, getStandingUrl } = get()
    return getAvatarUrl(creatureId, expression) || getStandingUrl(creatureId, expression)
  },

  setSprite: (creatureId, imageType, expression, dataUrl, mimeType) => {
    const key = makeKey(creatureId, imageType, expression)
    set(state => {
      const newMap = new Map(state.sprites)
      newMap.set(key, dataUrl)
      return { sprites: newMap }
    })
    idbPut({ key, creatureId, imageType, expression, dataUrl, mimeType, updatedAt: Date.now() })
  },

  removeSprite: (creatureId, imageType, expression) => {
    const key = makeKey(creatureId, imageType, expression)
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

  hasAnySprite: (creatureId) => {
    const prefix = `${creatureId}__`
    for (const k of get().sprites.keys()) {
      if (k.startsWith(prefix)) return true
    }
    return false
  },

  hasStanding: (creatureId) => {
    const prefix = `${creatureId}__standing__`
    for (const k of get().sprites.keys()) {
      if (k.startsWith(prefix)) return true
    }
    return false
  },

  getCreatureExpressions: (creatureId, imageType) => {
    const prefix = `${creatureId}__${imageType}__`
    const expressions: GalExpression[] = []
    for (const k of get().sprites.keys()) {
      if (k.startsWith(prefix)) {
        const expr = k.slice(prefix.length) as GalExpression
        expressions.push(expr)
      }
    }
    return expressions
  },

  getAllCreatureIds: () => {
    const ids = new Set<string>()
    for (const k of get().sprites.keys()) {
      const firstSep = k.indexOf('__')
      if (firstSep > 0) ids.add(k.slice(0, firstSep))
    }
    return Array.from(ids)
  },

  exportAll: async () => {
    const records = await idbGetAll()
    return {
      version: 2 as const,
      sprites: records.map(r => ({
        creatureId: r.creatureId,
        imageType: r.imageType,
        expression: r.expression,
        dataUrl: r.dataUrl,
        mimeType: r.mimeType,
      })),
    }
  },

  importAll: async (data) => {
    if (data.version !== 2) throw new Error('Unsupported export version')
    const { setSprite } = get()
    let count = 0
    for (const s of data.sprites) {
      setSprite(s.creatureId, s.imageType, s.expression, s.dataUrl, s.mimeType)
      count++
    }
    return count
  },
}))
