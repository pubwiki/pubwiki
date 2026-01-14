/**
 * Quadstore backend adapter
 * 
 * Provides low-level access to quadstore with abstract-level storage.
 * Uses a sublevel to isolate quadstore data from other store data.
 */

import { Quadstore } from 'quadstore'
import { DataFactory } from 'n3'
import type { Quad } from '@rdfjs/types'
import type { QuadPattern, LevelInstance } from '../types.js'

const { defaultGraph } = DataFactory

/** Sublevel name for RDF data */
export const DATA_SUBLEVEL = 'rdf'

/**
 * Store backend that wraps quadstore with abstract-level storage
 */
export class StoreBackend {
  private dataStore: Quadstore | null = null
  private dataLevel: LevelInstance | null = null
  private _isOpen = false

  constructor(
    private level: LevelInstance
  ) {}

  /**
   * Check if the backend is open
   */
  get isOpen(): boolean {
    return this._isOpen
  }

  /**
   * Get the underlying quadstore instance
   */
  get store(): Quadstore {
    if (!this.dataStore) {
      throw new Error('Store not open. Call open() first.')
    }
    return this.dataStore
  }

  /**
   * Get the underlying level instance
   */
  get levelInstance(): LevelInstance {
    return this.level
  }

  /**
   * Open the backend
   */
  async open(): Promise<void> {
    if (this._isOpen) return

    // Create a sublevel for quadstore to isolate its data
    this.dataLevel = this.level.sublevel(DATA_SUBLEVEL, { valueEncoding: 'utf8' }) as LevelInstance

    // Create quadstore with n3 DataFactory using the sublevel
    this.dataStore = new Quadstore({
      backend: this.dataLevel,
      dataFactory: DataFactory,
    })

    await this.dataStore.open()
    this._isOpen = true
  }

  /**
   * Close the backend
   */
  async close(): Promise<void> {
    if (!this._isOpen) return

    if (this.dataStore) {
      await this.dataStore.close()
      this.dataStore = null
    }
    this._isOpen = false
  }

  /**
   * Insert a quad into the store
   */
  async insert(quad: Quad): Promise<void> {
    await this.store.put(quad)
  }

  /**
   * Insert multiple quads
   */
  async batchInsert(quads: Quad[]): Promise<void> {
    if (quads.length === 0) return
    await this.store.multiPut(quads)
  }

  /**
   * Delete a quad from the store
   */
  async delete(quad: Quad): Promise<void> {
    await this.store.del(quad)
  }

  /**
   * Delete multiple quads matching a pattern
   */
  async batchDelete(pattern: QuadPattern): Promise<Quad[]> {
    const matches = await this.query(pattern)
    if (matches.length > 0) {
      await this.store.multiDel(matches)
    }
    return matches
  }

  /**
   * Query quads matching a pattern
   */
  async query(pattern: QuadPattern): Promise<Quad[]> {
    const queryPattern: Record<string, unknown> = {}
    
    if (pattern.subject) {
      queryPattern.subject = pattern.subject
    }
    if (pattern.predicate) {
      queryPattern.predicate = pattern.predicate
    }
    if (pattern.object !== undefined && pattern.object !== null) {
      queryPattern.object = pattern.object
    }
    if (pattern.graph) {
      queryPattern.graph = pattern.graph
    }
    // Note: If graph is not specified, query all graphs (no default to defaultGraph)

    const result = await this.store.get(queryPattern)
    return result.items as Quad[]
  }

  /**
   * Get all quads in the store
   */
  async getAllQuads(): Promise<Quad[]> {
    // Query without graph restriction to get quads from all graphs
    const result = await this.store.get({})
    return result.items as Quad[]
  }

  /**
   * Count all quads in the store
   */
  async count(): Promise<number> {
    const allQuads = await this.getAllQuads()
    return allQuads.length
  }

  /**
   * Clear all quads from the store
   */
  async clear(): Promise<void> {
    const allQuads = await this.getAllQuads()
    if (allQuads.length > 0) {
      await this.store.multiDel(allQuads)
    }
  }
}

/**
 * Create a new store backend with the given level instance
 */
export async function createBackend(level: LevelInstance): Promise<StoreBackend> {
  const backend = new StoreBackend(level)
  await backend.open()
  return backend
}

// Re-export types for convenience
export type { Quad, QuadPattern }