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
  NodeRef,
  NodeSnapshot,
  SnapshotEdge
} from './utils/types';

export {
  createPromptNodeData,
  createInputNodeData,
  createGeneratedNodeData,
  restoreSnapshot,
  syncNode,
  hasVersionHistory,
  getVersionCount,
  generateCommitHash,
  snapshotStore
} from './utils/types';

// Hashtag utilities
export {
  parseHashtags,
  getUniqueHashtagNames,
  resolvePromptContent,
  resolvePromptContentFromRefs,
  getHashtagConnections,
  getHashtagConnectionsFromSnapshotEdges
} from './utils/hashtag';

// Version control
export type { HistoricalTreeResult } from './utils/version';
export {
  prepareForGeneration,
  rebuildHistoricalTree,
  styleEdgesForVersions
} from './utils/version';

// Context
export type { StudioContext, PreviewState } from './stores/context';
export { setStudioContext, getStudioContext } from './stores/context';
