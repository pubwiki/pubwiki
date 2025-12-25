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
  SandboxNodeData,
  LoaderNodeData,
  StateNodeData,
  NodeRef,
  NodeSnapshot,
  SnapshotEdge
} from './utils/types';

export {
  createPromptNodeData,
  createInputNodeData,
  createGeneratedNodeData,
  createVFSNodeData,
  createSandboxNodeData,
  createLoaderNodeData,
  createStateNodeData,
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
  parseMountpoints,
  getUniqueRefTagNames,
  getUniqueMountpointPaths,
  resolvePromptContent,
  resolvePromptContentFromRefs,
  resolveInputContent,
  getRefTagConnections,
  getRefTagConnectionsFromSnapshotEdges,
  getInputTagConnections,
  getInputTagConnectionsFromSnapshotEdges,
  getMountpointConnections,
  getMountpointConnectionsFromSnapshotEdges,
  getInputTags
} from './utils/reftag';

export type {
  ParsedRefTag,
  ParsedMountpoint,
  ResolvedPrompt
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

// RDF Store (for State nodes)
export {
  QuadstoreRDFStore,
  getNodeRDFStore,
  closeNodeRDFStore,
  closeAllRDFStores
} from './stores/rdf';

// Import utilities
export type { ContentFetcher } from './utils/import';
export {
  convertArtifactToStudioGraph,
  importArtifactToNewProject,
  addArtifactToProject
} from './utils/import';
