/**
 * Quadstore backend adapter
 * 
 * Provides low-level access to quadstore with abstract-level storage.
 * Uses a sublevel to isolate quadstore data from other store data.
 */

import { Quadstore } from 'quadstore'
import { DataFactory } from 'n3'
import type { Quad } from '@rdfjs/types'
import type { Triple, TriplePattern, LevelInstance } from '../types.js'

const { quad, defaultGraph } = DataFactory

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
   * Convert a Triple to a quadstore quad
   * Now directly uses RDF.js types from Triple
   */
  private tripleToQuad(triple: Triple): Quad {
    return quad(triple.subject, triple.predicate, triple.object, defaultGraph())
  }

  /**
   * Convert a quadstore quad to a Triple
   * Now directly extracts RDF.js types
   */
  private quadToTriple(q: Quad): Triple {
    return {
      subject: q.subject as Triple['subject'],
      predicate: q.predicate as Triple['predicate'],
      object: q.object as Triple['object']
    }
  }

  /**
   * Insert a triple into the store
   */
  async insert(triple: Triple): Promise<void> {
    const q = this.tripleToQuad(triple)
    await this.store.put(q)
  }

  /**
   * Insert multiple triples
   */
  async batchInsert(triples: Triple[]): Promise<void> {
    if (triples.length === 0) return
    const quads = triples.map(t => this.tripleToQuad(t))
    await this.store.multiPut(quads)
  }

  /**
   * Delete a triple from the store
   */
  async delete(triple: Triple): Promise<void> {
    const q = this.tripleToQuad(triple)
    await this.store.del(q)
  }

  /**
   * Delete multiple triples matching a pattern
   */
  async batchDelete(pattern: TriplePattern): Promise<Triple[]> {
    const matches = await this.query(pattern)
    if (matches.length > 0) {
      const quads = matches.map(t => this.tripleToQuad(t))
      await this.store.multiDel(quads)
    }
    return matches
  }

  /**
   * Query triples matching a pattern
   */
  async query(pattern: TriplePattern): Promise<Triple[]> {
    const queryPattern: Record<string, unknown> = { graph: defaultGraph() }
    
    if (pattern.subject) {
      queryPattern.subject = pattern.subject
    }
    if (pattern.predicate) {
      queryPattern.predicate = pattern.predicate
    }
    if (pattern.object !== undefined && pattern.object !== null) {
      queryPattern.object = pattern.object
    }

    const result = await this.store.get(queryPattern)
    return result.items.map(q => this.quadToTriple(q as Quad))
  }

  /**
   * Get all triples in the store
   */
  async getAllTriples(): Promise<Triple[]> {
    return this.query({})
  }

  /**
   * Count all triples in the store
   */
  async count(): Promise<number> {
    const result = await this.store.get({ graph: defaultGraph() })
    return result.items.length
  }

  /**
   * Clear all triples from the store
   */
  async clear(): Promise<void> {
    const allTriples = await this.getAllTriples()
    if (allTriples.length > 0) {
      const quads = allTriples.map(t => this.tripleToQuad(t))
      await this.store.multiDel(quads)
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
export type { Triple, TriplePattern }