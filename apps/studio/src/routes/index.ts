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
} from '$lib/types';

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
} from '$lib/types';

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
} from '$lib/graph';

export type {
  HandleSpec,
  NodeSpec,
  ParsedRefTag,
  ParsedMountpoint,
  ResolvedPrompt
} from '$lib/graph';

// Version module
export {
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
} from '$lib/version';

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
} from '$lib/version';

// State management
export type { StudioContext, PreviewState } from '$lib/state';
export { setStudioContext, getStudioContext } from '$lib/state';
export {
  dispatchConnection,
  dispatchEdgeDeletes,
  dispatchNodeDeletes,
  onConnection,
  onEdgeDelete,
  onNodeDelete,
  clearAllHandlers
} from '$lib/state';
export type {
  ConnectionEvent,
  EdgeDeleteEvent,
  NodeDeleteEvent,
  ConnectionHandler,
  EdgeDeleteHandler,
  NodeDeleteHandler
} from '$lib/state';

// Persistence
export {
  db,
  saveEdges,
  getEdges,
  liveEdges,
  liveProjects,
  getCurrentProject,
  setCurrentProject,
  clearCurrentProject,
  ensureProject,
  saveProject,
  deleteProject,
  nodeStore,
  layoutStore
} from '$lib/persistence';

export type {
  StoredNodeData,
  StoredEdge,
  StoredProject,
  NodeLayout
} from '$lib/persistence';

// VFS
export { getNodeVfs, getVfsFactory } from '$lib/vfs';
export type { VersionedVfs } from '$lib/vfs';

// RDF Store (for State nodes)
export {
  getNodeRDFStore,
  closeNodeRDFStore,
  closeAllRDFStores,
  RDFStore
} from '$lib/rdf';

// Import/Export
export type { PublishMetadata } from '$lib/io';
export {
  convertArtifactToStudioGraph,
  importArtifactToNewProject,
  addArtifactToProject,
  publishArtifact
} from '$lib/io';
