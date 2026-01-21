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
  createMountpointHandleId,
  isMountpointHandle,
  getMountpointId,
  generateMountpointId,
  createLoaderMountpointHandleId,
  isLoaderMountpointHandle,
  getLoaderMountpointId,
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
  MOUNTPOINT_PATTERN,
  parseRefTags,
  parseMountpoints,
  getUniqueRefTagNames,
  getUniqueMountpointPaths,
  isRefTagEdge,
  getRefTagNameFromEdge,
  getRefTagConnections,
  getRefTagConnectionsFromSnapshotEdges,
  isInputTagEdge,
  getInputTagNameFromEdge,
  getInputTagConnections,
  getInputTagConnectionsFromSnapshotEdges,
  getSystemPromptConnection,
  isMountpointEdge,
  getMountpointIdFromEdge,
  getMountpointConnections,
  getMountpointConnectionsFromSnapshotEdges,
  resolvePromptContent,
  resolvePromptContentFromRefs,
  resolveInputContent,
  getInputTagsFromBlocks,
  // New ContentBlock support
  getRefTagNamesFromBlocks,
  resolveContentBlocks,
  blocksToText,
  type ParsedRefTag,
  type ParsedMountpoint,
  type ResolvedPrompt
} from './reftag';
