/**
 * @pubwiki/rdfstore
 * 
 * RDF store with checkpoint-based versioning
 * 
 * Storage architecture:
 * - Quadstore (RDF data): Uses abstract-level (browser-level/memory-level)
 * - Checkpoints (version snapshots): Uses Dexie.js (IndexedDB)
 * 
 * 重构后：移除了区块链式版本控制，简化为纯 Checkpoint 快照模式
 */

// Types
export type {
  QuadPattern,
  Checkpoint,
  CheckpointOptions,
  StoreEventType,
  StoreEvents,
  LevelInstance,
} from './types.js'

// Re-export Quad type from @rdfjs/types for RDF operations
export type { Quad, Quad_Subject, Quad_Predicate, Quad_Object, Quad_Graph } from '@rdfjs/types'

// Re-export Quad from @pubwiki/api for sync protocol
export type { Quad as SyncQuad } from '@pubwiki/api'

// Main Store API
export { RDFStore } from './store.js'
export type { SparqlBinding, StorageConfig } from './store.js'

// Backend
export { StoreBackend, createBackend } from './backend/index.js'

// Checkpoint Manager (Dexie-based)
export { 
  CheckpointManager, 
  createCheckpointManager,
  createCheckpointManagerWithStore,
  createCheckpointManagerWithDatabase,
  CheckpointStore,
  CheckpointDatabase,
} from './version/index.js'

export type {
  CheckpointRecord,
  CheckpointDataRecord,
} from './version/index.js'

// Serialization (Import/Export)
export {
  exportQuads,
  importQuads,
  detectFormat,
  exportToJsonl,
  importFromJsonl,
  exportToNQuads,
  importFromNQuads,
  exportToCompactJson,
  importFromCompactJson,
  exportToJson,
  importFromJson,
  // Full state export/import
  exportFullState,
  importFullState,
} from './serialization/index.js'
export type {
  SerializationFormat,
  ExportOptions,
  ImportOptions,
  ExportMetadata,
  FullStateExport,
  FullStateExportOptions,
} from './serialization/index.js'

// Utilities
export {
  generateId,
  EventEmitter,
} from './utils/index.js'

// Quad conversion utilities
export { fromRdfQuad, toRdfQuad } from './convert.js'
