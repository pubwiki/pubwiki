/**
 * Studio Types - Unified exports
 */

// Node data types
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
  Mountpoint,
  NodeContent
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
