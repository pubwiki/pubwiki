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
  /** Track pending cleanups so get() can wait for them. */
  private readonly pendingCleanups = new Map<string, Promise<void>>();
  private readonly createBackend: StorageBackendFactory;

  constructor(createBackend: StorageBackendFactory) {
    this.createBackend = createBackend;
  }

  /** Get or create a TripleStore for a given node, with restore + auto-persist. */
  get(nodeId: string): Promise<TripleStore> {
    let promise = this.entries.get(nodeId);
    if (!promise) {
      // Wait for any in-flight cleanup to finish before initialising a new store,
      // otherwise restoreLatest() may read stale data from IndexedDB.
      const pending = this.pendingCleanups.get(nodeId);
      const init = pending
        ? pending.then(() => this.initialize(nodeId))
        : this.initialize(nodeId);
      promise = init;
      this.entries.set(nodeId, promise);
      // Allow retry on initialization failure
      promise.catch(() => this.entries.delete(nodeId));
    }
    return promise.then(entry => entry.store);
  }

  /** Close and persist a single store. */
  async close(nodeId: string): Promise<void> {
    const entryPromise = this.entries.get(nodeId);
    this.entries.delete(nodeId);

    if (!entryPromise) return;

    // Build the full cleanup chain as a single promise and register it
    // SYNCHRONOUSLY so that a concurrent get() always sees it — even
    // before the first microtask tick.
    const cleanupPromise = entryPromise
      .then(entry => this.cleanup(entry, nodeId))
      .catch(() => {});

    this.pendingCleanups.set(nodeId, cleanupPromise);
    cleanupPromise.finally(() => {
      // Only delete if this is still the tracked cleanup
      if (this.pendingCleanups.get(nodeId) === cleanupPromise) {
        this.pendingCleanups.delete(nodeId);
      }
    });
    await cleanupPromise;
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
          store.persist()
            .catch(err =>
              console.error(`[StoreManager] persist failed for ${nodeId}:`, err)
            );
        } else {
          console.warn(`[StoreManager] skip persist for ${nodeId}: store closed`);
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
