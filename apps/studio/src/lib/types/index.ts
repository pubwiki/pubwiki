/**
 * Studio Types - Unified exports
 * 
 * Most types come from @pubwiki/flow-core, with Studio-specific wrappers
 * for xyflow compatibility.
 */

// Node data types (flow-core types with xyflow compatibility)
export type {
  BaseNodeData,
  InputNodeData,
  PromptNodeData,
  GeneratedNodeData,
  VFSNodeData,
  SandboxNodeData,
  LoaderNodeData,
  StateNodeData,
  StudioNodeData,
  NodeContent,
  VfsRef,
  VfsMountConfig
} from './node-data';

// Content classes and factory functions
export {
  InputContent,
  PromptContent,
  GeneratedContent,
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent,
  restoreContent,
  createInputNodeData,
  createPromptNodeData,
  createGeneratedNodeData,
  createVFSNodeData,
  createSandboxNodeData,
  createLoaderNodeData,
  createStateNodeData
} from './node-data';

// Content types (re-exported from flow-core via content.ts)
export type { NodeType, ContentBlock, TextBlock, RefTagBlock, InputGenerationConfig } from './content';
export { blocksToText, getRefTagNamesFromBlocks } from './content';

// Flow types (for SvelteFlow rendering layer - Studio-specific)
export type { FlowNodeData, FlowNode } from './flow';
export { createFlowNode, getFlowNodeType } from './flow';

// API types (re-exports from @pubwiki/api plus local types)
export type {
  ArtifactListItem,
  ArtifactVersion,
  ArtifactLineageItem,
  ArtifactNodeSummary,
  ArtifactEdge,
  ArtifactNodeType,
  NodeFileInfo,
  Tag,
  Pagination,
  ProjectListItem,
  ProjectRole,
  UserProjectListItem,
  ArtifactNodeDetail,
  ArtifactGraphData
} from './api';
