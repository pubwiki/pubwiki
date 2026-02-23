/**
 * Node Content Types - Re-exported from @pubwiki/flow-core
 * 
 * This module re-exports all content types and utilities from flow-core.
 * The actual implementations are in @pubwiki/flow-core/types/content.
 */

// Re-export everything from flow-core
export {
  type ArtifactNodeContent,
  type NodeContent,
  type InputGenerationConfig,
  type TextBlock,
  type RefTagBlock,
  type ContentBlock,
  type VfsRef,
  type VfsMountConfig,
  type NodeType,
  InputContent,
  PromptContent,
  GeneratedContent,
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent,
  restoreContent,
  blocksToText,
  getRefTagNamesFromBlocks
} from '@pubwiki/flow-core';