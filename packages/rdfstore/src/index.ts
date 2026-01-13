/**
 * @pubwiki/rdfstore
 * 
 * RDF store with immutable version DAG
 */

// Types
export type {
  QuadPattern,
  Operation,
  Ref,
  RefNode,
  Checkpoint,
  StoreConfig,
  StoreEventType,
  StoreEvents,
  LevelInstance,
} from './types.js'

export { DEFAULT_STORE_CONFIG, ROOT_REF } from './types.js'

// Re-export Quad types from @rdfjs/types for convenience
export type { 
  Quad, 
  Quad_Subject, 
  Quad_Predicate, 
  Quad_Object, 
  Quad_Graph 
} from '@rdfjs/types'

// Main Store API
export { RDFStore } from './store.js'
export type { SparqlBinding } from './store.js'

// Backend
export { StoreBackend, createBackend } from './backend/index.js'

// Version DAG
export { VersionDAG, createVersionDAG } from './version/index.js'

// Delta computation
export {
  computeDelta,
  applyDelta,
  invertOperation,
  invertOperations,
  optimizeOperations,
  quadsEqual,
  uniqueQuads,
} from './delta/index.js'

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
