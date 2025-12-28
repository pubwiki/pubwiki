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
  Mountpoint,
  NodeContent
} from './types';

export {
  createPromptNodeData,
  createInputNodeData,
  createGeneratedNodeData,
  createVFSNodeData,
  createSandboxNodeData,
  createLoaderNodeData,
  createStateNodeData,
  InputContent,
  PromptContent,
  GeneratedContent,
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent,
  restoreContent
} from './types';

// Re-export MessageBlock types from @pubwiki/chat
export type {
  MessageBlock,
  MessageBlockType,
  ToolCallStatus
} from '@pubwiki/chat';

// Graph utilities
export {
  REFTAG_PATTERN,
  MOUNTPOINT_PATTERN,
  parseRefTags,
  parseMountpoints,
  getUniqueRefTagNames,
  getUniqueMountpointPaths,
  resolvePromptContentFromRefs,
  getRefTagConnectionsFromSnapshotEdges,
  HandleId,
  DataType,
  Cardinality,
  validateConnection,
  createRefTagHandleId,
  isRefTagHandle,
  getRefTagName,
  createMountpointHandleId,
  isMountpointHandle,
  getMountpointId,
  generateMountpointId,
  createLoaderMountpointHandleId,
  isLoaderMountpointHandle,
  getLoaderMountpointId,
  positionNewNodesFromSources,
  getNodeDimensions,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  HORIZONTAL_GAP,
  VERTICAL_GAP
} from './graph';

export type {
  HandleSpec,
  NodeSpec,
  ParsedRefTag,
  ParsedMountpoint,
  ResolvedPrompt
} from './graph';

// Version module
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
  createPreviewController,
  prepareForGeneration,
  versionHandlerRegistry,
  registerVersionHandler,
  getVersionHandler
} from './version';

export type {
  NodeRef,
  NodeSnapshot,
  SnapshotEdge,
  SnapshotPosition,
  Versionable,
  HistoricalTreeResult,
  PreviewController,
  VersionHandler,
  PreviewState as VersionPreviewState
} from './version';

// State management
export type { StudioContext, PreviewState } from './state';
export { setStudioContext, getStudioContext } from './state';
export {
  dispatchConnection,
  dispatchEdgeDeletes,
  dispatchNodeDeletes,
  onConnection,
  onEdgeDelete,
  onNodeDelete,
  clearAllHandlers
} from './state';
export type {
  ConnectionEvent,
  EdgeDeleteEvent,
  NodeDeleteEvent,
  ConnectionHandler,
  EdgeDeleteHandler,
  NodeDeleteHandler
} from './state';

// Persistence
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
  getCurrentProject,
  setCurrentProject,
  clearCurrentProject,
  ensureProject,
  saveProject,
  deleteProject,
  remapNodeIds
} from './persistence';

export type {
  StoredSnapshot,
  StoredNode,
  StoredEdge,
  StoredProject
} from './persistence';

// VFS
export { getNodeVfs, getVfsFactory } from './vfs';
export type { VersionedVfs } from './vfs';

// RDF Store (for State nodes)
export {
  getNodeRDFStore,
  closeNodeRDFStore,
  closeAllRDFStores,
  QuadstoreRDFStore
} from './rdf';

// Import/Export
export type { ContentFetcher, PublishMetadata } from './io';
export {
  convertArtifactToStudioGraph,
  importArtifactToNewProject,
  addArtifactToProject,
  publishArtifact
} from './io';
