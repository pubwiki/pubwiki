/**
 * Studio Module
 * 
 * Re-exports all public types and utilities from the studio module.
 */

// Types (excluding version types which are now in stores/version)
export type {
  StudioNodeData,
  BaseNodeData,
  PromptNodeData,
  InputNodeData,
  GeneratedNodeData,
  VFSNodeData,
  SandboxNodeData,
  LoaderNodeData,
  StateNodeData
} from './utils/types';

export {
  createPromptNodeData,
  createInputNodeData,
  createGeneratedNodeData,
  createVFSNodeData,
  createSandboxNodeData,
  createLoaderNodeData,
  createStateNodeData
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

// Version control - preparation for generation
export {
  prepareForGeneration
} from './utils/version';

// Version module - core version control functionality
export {
  initSnapshotStore,
  snapshotStore,
  generateCommitHash,
  syncNode,
  restoreSnapshot,
  hasVersionHistory,
  getVersionCount,
  getNodeSnapshots,
  rebuildHistoricalTree,
  styleEdgesForVersions,
  createPreviewController
} from './stores/version';

export type {
  NodeRef,
  NodeSnapshot,
  SnapshotEdge,
  SnapshotPosition,
  Versionable,
  VersionRefExtractor,
  HistoricalTreeResult,
  PreviewControllerConfig,
  PreviewController
} from './stores/version';

// Context
export type { StudioContext, PreviewState } from './stores/context';
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
