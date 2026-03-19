/**
 * TripleStore Manager
 *
 * Backend-agnostic singleton registry for TripleStore instances.
 * Caches initialization promises to prevent race conditions from concurrent callers.
 * Handles restore-on-open, debounced auto-persist, and orderly shutdown.
 *
 * Apps provide a StorageBackend factory; the manager handles the rest.
 */

import { createTripleStore, type TripleStore, type StorageBackend } from '@pubwiki/rdfstore';

// ============================================================================
// Types
// ============================================================================

export type StorageBackendFactory = (nodeId: string) => StorageBackend;

interface StoreEntry {
  store: TripleStore;
  unsub: () => void;
  persistTimer?: ReturnType<typeof setTimeout>;
}

const PERSIST_DEBOUNCE_MS = 500;

// ============================================================================
// StoreManager
// ============================================================================

export class StoreManager {
  private readonly entries = new Map<string, Promise<StoreEntry>>();
  private readonly createBackend: StorageBackendFactory;

  constructor(createBackend: StorageBackendFactory) {
    this.createBackend = createBackend;
  }

  /** Get or create a TripleStore for a given node, with restore + auto-persist. */
  get(nodeId: string): Promise<TripleStore> {
    let promise = this.entries.get(nodeId);
    if (!promise) {
      promise = this.initialize(nodeId);
      this.entries.set(nodeId, promise);
      // Allow retry on initialization failure
      promise.catch(() => this.entries.delete(nodeId));
    }
    return promise.then(entry => entry.store);
  }

  /** Close and persist a single store. */
  async close(nodeId: string): Promise<void> {
    const promise = this.entries.get(nodeId);
    this.entries.delete(nodeId);

    if (!promise) return;

    let entry: StoreEntry;
    try {
      entry = await promise;
    } catch {
      return;
    }

    this.cleanup(entry, nodeId);
  }

  /** Close all managed stores (e.g. on page unload). */
  async closeAll(): Promise<void> {
    const nodeIds = [...this.entries.keys()];
    await Promise.all(nodeIds.map(id => this.close(id)));
  }

  // ── Private ──

  private async initialize(nodeId: string): Promise<StoreEntry> {
    const backend = this.createBackend(nodeId);
    const store = createTripleStore({ backend });

    await store.restoreLatest();

    const entry: StoreEntry = { store, unsub: () => {} };

    entry.unsub = store.on('change', () => {
      if (entry.persistTimer) clearTimeout(entry.persistTimer);
      entry.persistTimer = setTimeout(() => {
        entry.persistTimer = undefined;
        if (store.isOpen) {
          store.persist().catch(err =>
            console.error(`[StoreManager] persist failed for ${nodeId}:`, err)
          );
        }
      }, PERSIST_DEBOUNCE_MS);
    });

    return entry;
  }

  private async cleanup(entry: StoreEntry, nodeId: string): Promise<void> {
    if (entry.persistTimer) clearTimeout(entry.persistTimer);
    entry.unsub();

    if (entry.store.isOpen) {
      await entry.store.persistAll().catch(err =>
        console.error(`[StoreManager] final persist failed for ${nodeId}:`, err)
      );
      entry.store.close();
    }
  }
}
