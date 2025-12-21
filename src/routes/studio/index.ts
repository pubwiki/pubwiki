/**
 * Studio Module
 * 
 * Re-exports all public types and utilities from the studio module.
 */

// Types
export type {
  StudioNodeData,
  BaseNodeData,
  PromptNodeData,
  InputNodeData,
  GeneratedNodeData,
  VFSNodeData,
  NodeRef,
  NodeSnapshot,
  SnapshotEdge
} from './utils/types';

export {
  createPromptNodeData,
  createInputNodeData,
  createGeneratedNodeData,
  createVFSNodeData,
  restoreSnapshot,
  syncNode,
  hasVersionHistory,
  getVersionCount,
  generateCommitHash,
  snapshotStore
} from './utils/types';

// RefTag utilities
export {
  parseRefTags,
  getUniqueRefTagNames,
  resolvePromptContent,
  resolvePromptContentFromRefs,
  getRefTagConnections,
  getRefTagConnectionsFromSnapshotEdges
} from './utils/reftag';

// Version control
export type { HistoricalTreeResult } from './utils/version';
export {
  prepareForGeneration,
  rebuildHistoricalTree,
  styleEdgesForVersions
} from './utils/version';

// Context
export type { StudioContext, PreviewState } from './stores/context';

// Persistence (Dexie/IndexedDB)
export { initSnapshotStore } from './stores/snapshot';
export {
  db,
  saveGraph,
  loadGraph,
  saveNodes,
  getNodes,
  saveEdges,
  getEdges,
  liveNodes,
  liveEdges,
  liveSnapshots,
  liveProjects,
  type StoredSnapshot,
  type StoredNode,
  type StoredEdge,
  type StoredProject
} from './stores/db';
export {
  useLiveQuery,
  useObservable,
  usePersistedState,
  type LiveQueryResult,
  type PersistedStateResult,
  type GraphStateResult
} from './stores/live-query.svelte';
export { setStudioContext, getStudioContext } from './stores/context';

// Import utilities
export type { ContentFetcher } from './utils/import';
export {
  convertArtifactToStudioGraph,
  importArtifactToNewProject,
  addArtifactToProject
} from './utils/import';
