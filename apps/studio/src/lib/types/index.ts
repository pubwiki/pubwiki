/**
 * Studio Types - Unified exports
 */

// Node data types
export type {
  BaseNodeData,
  OriginalRef,
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

// Content types (for direct access if needed)
export type { NodeType } from './content';
export {
  InputContent as InputContentClass,
  PromptContent as PromptContentClass,
  GeneratedContent as GeneratedContentClass,
  VFSContent as VFSContentClass,
  SandboxContent as SandboxContentClass,
  LoaderContent as LoaderContentClass,
  StateContent as StateContentClass,
  restoreContent as restoreContentFromJSON
} from './content';

// ContentBlock types (for structured reftag storage)
export type { ContentBlock, TextBlock, RefTagBlock, InputGenerationConfig, CheckpointInfo, CheckpointVisibility } from './content';
export { blocksToText, getRefTagNamesFromBlocks } from './content';

// Flow types (for SvelteFlow rendering layer)
export type { FlowNodeData, FlowNode } from './flow';
export { createFlowNode, getFlowNodeType } from './flow';

// API types (re-exports from @pubwiki/api plus local types)
export type {
  ArtifactListItem,
  ArtifactType,
  ArtifactVersion,
  ArtifactLineageItem,
  ArtifactNodeSummary,
  ArtifactEdge,
  ArtifactNodeType,
  NodeFileInfo,
  LineageType,
  VisibilityType,
  Tag,
  Pagination,
  ProjectListItem,
  ProjectRole,
  UserProjectRole,
  UserProjectListItem,
  ArtifactNodeDetail,
  ArtifactGraphData
} from './api';
