/**
 * Quadstore-based RDFStore Implementation
 *
 * Provides an RDFStore adapter using quadstore + browser-level for the studio.
 * This allows State nodes to persist RDF triples in IndexedDB via quadstore.
 */

import { Quadstore } from 'quadstore';
import { BrowserLevel } from 'browser-level';
import { DataFactory } from 'n3';
import type { RDFStore, Triple, TriplePattern } from '@pubwiki/lua';

const { namedNode, literal, defaultGraph, quad } = DataFactory;

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert a JS value to an RDF term
 */
function toTerm(value: any) {
  if (typeof value === 'string') {
    // If looks like a URI (has : prefix), treat as namedNode
    if (value.includes(':')) {
      return namedNode(value);
    }
    return literal(value);
  }
  if (typeof value === 'number') {
    return literal(String(value), namedNode('http://www.w3.org/2001/XMLSchema#decimal'));
  }
  if (typeof value === 'boolean') {
    return literal(String(value), namedNode('http://www.w3.org/2001/XMLSchema#boolean'));
  }
  // Fallback: JSON stringify objects
  return literal(JSON.stringify(value));
}

/**
 * Convert an RDF term back to a JS value
 */
function fromTerm(term: any): any {
  if (term.termType === 'NamedNode') {
    return term.value;
  }
  if (term.termType === 'Literal') {
    const datatype = term.datatype?.value;
    if (datatype === 'http://www.w3.org/2001/XMLSchema#decimal' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#integer' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#float' ||
        datatype === 'http://www.w3.org/2001/XMLSchema#double') {
      return Number(term.value);
    }
    if (datatype === 'http://www.w3.org/2001/XMLSchema#boolean') {
      return term.value === 'true';
    }
    // Try parse as JSON for objects
    try {
      const parsed = JSON.parse(term.value);
      if (typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // not JSON, return as string
    }
    return term.value;
  }
  return term.value;
}

/**
 * Convert a Triple to an RDF Quad
 */
function tripleToQuad(triple: Triple) {
  return quad(
    namedNode(triple.subject),
    namedNode(triple.predicate),
    toTerm(triple.object),
    defaultGraph()
  );
}

/**
 * Convert an RDF Quad to a Triple
 */
function quadToTriple(q: any): Triple {
  return {
    subject: q.subject.value,
    predicate: q.predicate.value,
    object: fromTerm(q.object)
  };
}

// ============================================================================
// QuadstoreRDFStore
// ============================================================================

/**
 * RDFStore implementation backed by Quadstore + BrowserLevel (IndexedDB)
 */
export class QuadstoreRDFStore implements RDFStore {
  private store: Quadstore;
  private _isOpen = false;

  /**
   * Create a new QuadstoreRDFStore.
   * @param dbName - IndexedDB database name (should be unique per State node)
   */
  private constructor(store: Quadstore) {
    this.store = store;
  }

  /**
   * Factory method - creates and opens the store
   */
  static async create(dbName: string): Promise<QuadstoreRDFStore> {
    const backend = new BrowserLevel(dbName);
    const store = new Quadstore({
      backend,
      dataFactory: DataFactory
    });
    await store.open();
    const instance = new QuadstoreRDFStore(store);
    instance._isOpen = true;
    return instance;
  }

  get isOpen(): boolean {
    return this._isOpen;
  }

  /**
   * Close the store (cleanup)
   */
  async close(): Promise<void> {
    if (this._isOpen) {
      await this.store.close();
      this._isOpen = false;
    }
  }

  // --------------------------------------------------------------------------
  // RDFStore Interface Implementation
  // --------------------------------------------------------------------------

  async insert(subject: string, predicate: string, object: any): Promise<void> {
    const quad = tripleToQuad({ subject, predicate, object });
    await this.store.put(quad);
  }

  async delete(subject: string, predicate: string, object?: any): Promise<void> {
    if (object !== undefined) {
      // Delete specific triple
      const q = tripleToQuad({ subject, predicate, object });
      await this.store.del(q);
    } else {
      // Delete all triples matching subject + predicate
      const results: Triple[] = [];
      const stream = this.store.match(
        namedNode(subject),
        namedNode(predicate),
        undefined,
        defaultGraph()
      );
      for await (const q of stream) {
        results.push(quadToTriple(q));
      }
      // Delete each matched quad
      for (const triple of results) {
        const q = tripleToQuad(triple);
        await this.store.del(q);
      }
    }
  }

  async query(pattern: TriplePattern): Promise<Triple[]> {
    const subject = pattern.subject ? namedNode(pattern.subject) : undefined;
    const predicate = pattern.predicate ? namedNode(pattern.predicate) : undefined;
    const object = pattern.object !== undefined ? toTerm(pattern.object) : undefined;

    const stream = this.store.match(subject, predicate, object, defaultGraph());
    const results: Triple[] = [];
    for await (const quad of stream) {
      results.push(quadToTriple(quad));
    }
    return results;
  }

  async batchInsert(triples: Triple[]): Promise<void> {
    const quads = triples.map(tripleToQuad);
    await this.store.multiPut(quads);
  }

  async batchDelete(patterns: TriplePattern[]): Promise<void> {
    for (const pattern of patterns) {
      const results = await this.query(pattern);
      for (const triple of results) {
        await this.delete(triple.subject, triple.predicate, triple.object);
      }
    }
  }
}

// ============================================================================
// Store Registry (for managing multiple State nodes)
// ============================================================================

const storeRegistry = new Map<string, QuadstoreRDFStore>();

/**
 * Get or create an RDFStore for a given State node
 * @param nodeId - Unique identifier for the State node
 */
export async function getNodeRDFStore(nodeId: string): Promise<QuadstoreRDFStore> {
  let store = storeRegistry.get(nodeId);
  if (!store || !store.isOpen) {
    const dbName = `pubwiki-state-${nodeId}`;
    store = await QuadstoreRDFStore.create(dbName);
    storeRegistry.set(nodeId, store);
  }
  return store;
}

/**
 * Close and remove an RDFStore for a given State node
 * @param nodeId - Unique identifier for the State node
 */
export async function closeNodeRDFStore(nodeId: string): Promise<void> {
  const store = storeRegistry.get(nodeId);
  if (store) {
    await store.close();
    storeRegistry.delete(nodeId);
  }
}

/**
 * Close all open RDF stores (cleanup on page unload)
 */
export async function closeAllRDFStores(): Promise<void> {
  for (const [nodeId, store] of storeRegistry) {
    await store.close();
    storeRegistry.delete(nodeId);
  }
}
