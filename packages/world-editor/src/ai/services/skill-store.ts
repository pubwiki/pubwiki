/**
 * SkillStore — Manages built-in + user-defined skills.
 *
 * Built-in skills come from `prompts/skills.ts` (read-only).
 * User skills are stored in IndexedDB, scoped globally (not per-project).
 *
 * Implements `SkillProvider` for the orchestrator.
 */

import type { SkillListItem } from '../types'
import type { SkillProvider } from '../copilot/tools/skill-tools'

// ============================================================================
// Types
// ============================================================================

export interface UserSkillEntry {
  id: string
  title: string
  description?: string
  content: string
  createdAt: number
  updatedAt: number
}

// ============================================================================
// Constants
// ============================================================================

const DB_NAME = 'world-editor-ai-skills'
const DB_VERSION = 1
const STORE_NAME = 'user_skills'

// ============================================================================
// SkillStore
// ============================================================================

export class SkillStore implements SkillProvider {
  private dbPromise: Promise<IDBDatabase>
  private cachedUserSkills: UserSkillEntry[] | null = null

  constructor() {
    this.dbPromise = this.openDB()
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        }
      }

      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  private async getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.dbPromise
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME)
  }

  // --------------------------------------------------------------------------
  // User Skills CRUD
  // --------------------------------------------------------------------------

  /**
   * Get all user-defined skills from IndexedDB.
   */
  async loadUserSkills(): Promise<UserSkillEntry[]> {
    const store = await this.getStore('readonly')
    return new Promise((resolve, reject) => {
      const request = store.getAll()
      request.onsuccess = () => {
        this.cachedUserSkills = request.result as UserSkillEntry[]
        resolve(this.cachedUserSkills)
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Save (upsert) a user skill.
   */
  async saveUserSkill(id: string, title: string, content: string, description?: string): Promise<void> {
    const existing = await this.getUserSkillEntry(id)
    const now = Date.now()
    const entry: UserSkillEntry = {
      id,
      title,
      description,
      content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }
    const store = await this.getStore('readwrite')
    return new Promise((resolve, reject) => {
      const request = store.put(entry)
      request.onsuccess = () => {
        this.cachedUserSkills = null // Invalidate cache
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Delete a user skill.
   */
  async deleteUserSkill(id: string): Promise<void> {
    const store = await this.getStore('readwrite')
    return new Promise((resolve, reject) => {
      const request = store.delete(id)
      request.onsuccess = () => {
        this.cachedUserSkills = null // Invalidate cache
        resolve()
      }
      request.onerror = () => reject(request.error)
    })
  }

  private async getUserSkillEntry(id: string): Promise<UserSkillEntry | null> {
    const store = await this.getStore('readonly')
    return new Promise((resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve((request.result as UserSkillEntry) ?? null)
      request.onerror = () => reject(request.error)
    })
  }

  // --------------------------------------------------------------------------
  // SkillProvider Implementation (for orchestrator)
  // --------------------------------------------------------------------------

  /**
   * Get all user-defined skills as SkillListItems.
   * Uses cached data if available (synchronous for SkillProvider interface).
   */
  getUserSkills(): SkillListItem[] {
    const skills = this.cachedUserSkills ?? []
    return skills.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      isBuiltIn: false,
    }))
  }

  /**
   * Get content of a user-defined skill by ID.
   * Uses cached data (synchronous for SkillProvider interface).
   */
  getUserSkillContent(id: string): string | null {
    const skills = this.cachedUserSkills ?? []
    const skill = skills.find((s) => s.id === id)
    return skill?.content ?? null
  }
}
