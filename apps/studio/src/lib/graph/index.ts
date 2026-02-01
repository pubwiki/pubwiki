/**
 * Studio Graph - Unified exports
 * 
 * Graph layout, connection validation, and reftag handling
 */

// Connection types and validation
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
  type HandleSpec,
  type NodeSpec
} from './connection';

// Layout utilities
export {
  positionNewNodesFromSources,
  getNodeDimensions,
  DEFAULT_NODE_WIDTH,
  DEFAULT_NODE_HEIGHT,
  HORIZONTAL_GAP,
  VERTICAL_GAP
} from './auto-layout';

// RefTag utilities
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
  resolvePromptContent,
  resolvePromptContentFromRefs,
  resolveInputContent,
  getInputTagsFromBlocks,
  // New ContentBlock support
  getRefTagNamesFromBlocks,
  resolveContentBlocks,
  blocksToText,
  type ParsedRefTag,
  type ResolvedPrompt
} from './reftag';
