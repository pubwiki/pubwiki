/**
 * Studio Graph - Unified exports
 * 
 * Graph layout, connection validation, and reftag handling
 */

// Connection types and validation - re-export from flow-core
export {
  HandleId,
  DataType,
  Cardinality,
  NodeRegistry,
  getNodeSpec,
  getHandleSpec,
  validateConnection,
  createRefTagHandleId,
  isRefTagHandle,
  getRefTagName,
  createTagHandleId,
  isTagHandle,
  getTagName,
  createVfsMountHandleId,
  isVfsMountHandle,
  getMountIdFromHandle,
  type HandleSpec,
  type NodeSpec
} from '@pubwiki/flow-core';

// Layout utilities - stay in Studio (UI-specific)
export {
  positionNewNodesFromSources,
  getNodeDimensions,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  HORIZONTAL_GAP,
  VERTICAL_GAP
} from './auto-layout';

// RefTag utilities - re-export from flow-core
export {
  REFTAG_PATTERN,
  parseRefTags,
  getUniqueRefTagNames,
  isRefTagEdge,
  getRefTagNameFromEdge,
  getRefTagConnections,
  getRefTagConnectionsFromSnapshotEdges,
  isInputTagEdge,
  getInputTagNameFromEdge,
  getInputTagConnections,
  getInputTagConnectionsFromSnapshotEdges,
  getSystemPromptConnection,
  getInputTagsFromBlocks,
  // New ContentBlock support
  getRefTagNamesFromBlocks,
  resolveContentBlocks,
  blocksToText,
  type ParsedRefTag,
  type ResolvedPrompt
} from '@pubwiki/flow-core';

// Content resolution utilities (Studio-specific, use nodeStore)
export {
  resolvePromptContent,
  resolvePromptContentFromRefs,
  resolveInputContent
} from './resolve';
