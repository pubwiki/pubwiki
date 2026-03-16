/**
 * @pubwiki/rdfstore — New public API
 *
 * Factory function + backend exports.
 */

// Types
export type {
  Value,
  Triple,
  MatchPattern,
  CheckpointInfo,
  CheckpointOptions,
  SerializedState,
  SerializedCheckpointEntry,
  Delta,
  ChangeEvent,
  StoreEvents,
} from './types'

// Interfaces
export type {
  TripleStoreInterface as TripleStore,
  LiveQuery,
  StorageBackend,
} from './store/interfaces'

// Implementation
import { TripleStoreImpl } from './store/triple-store'
import type { StorageBackend } from './store/interfaces'

export function createTripleStore(options?: {
  backend?: StorageBackend
}): TripleStoreImpl {
  return new TripleStoreImpl(options?.backend)
}

// Backends
export { MemoryBackend } from './backend/memory'
export { IndexedDBBackend } from './backend/indexeddb'

// Utilities (preserved from old API)
export { EventEmitter } from './utils/events'
export { generateId } from './utils/hash'

// Delta utilities
export { computeDelta, applyDelta } from './version/delta'
