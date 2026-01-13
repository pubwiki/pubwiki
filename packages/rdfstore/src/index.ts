/**
 * @pubwiki/rdfstore
 * 
 * RDF store with WAL-based versioning and snapshot support
 */

// Types
export type {
  Triple,
  TriplePattern,
  Operation,
  LogEntry,
  SnapshotRef,
  SnapshotInfo,
  StoreConfig,
  LogRecord,
  StoredSnapshotMeta,
  HistoryOptions,
  StoreEventType,
  StoreEvents,
  LevelInstance,
} from './types.js'

export { DEFAULT_STORE_CONFIG } from './types.js'

// Stateful API (main entry point)
export { RDFStore } from './stateful/index.js'

// Functional API
export {
  loadSnapshot,
  applyOperation,
  applyOperations,
  createEmptySnapshot,
  createSnapshot,
  computeTripleDelta,
  createSnapshotView,
  serializeTriples,
  deserializeTriples,
} from './functional/index.js'
export type { SnapshotView } from './functional/index.js'

// Backend
export { StoreBackend, createBackend } from './backend/index.js'

// Log management
export { LogManager, createLogManager, LogPersistence, createLogPersistence } from './log/index.js'

// Checkpoint management
export { createCheckpointManager, restoreFromCheckpoint } from './checkpoint/index.js'
export type { CheckpointManager } from './checkpoint/index.js'

// Delta computation
export {
  computeDelta,
  applyDelta,
  invertOperation,
  invertOperations,
  optimizeOperations,
  triplesEqual,
  uniqueTriples,
} from './delta/index.js'

// Serialization (Import/Export)
export {
  exportTriples,
  importTriples,
  detectFormat,
  exportToJsonl,
  importFromJsonl,
  exportToNTriples,
  importFromNTriples,
  exportToCompactJson,
  importFromCompactJson,
  exportToJson,
  importFromJson,
  exportOperations,
  importOperations,
} from './serialization/index.js'
export type {
  SerializationFormat,
  ExportOptions,
  ImportOptions,
  ExportMetadata,
} from './serialization/index.js'

// Utilities
export {
  generateId,
  generateSnapshotRef,
  generateCheckpointRef,
  isEmptySnapshotRef,
  generateEmptySnapshotRef,
  EventEmitter,
} from './utils/index.js'
