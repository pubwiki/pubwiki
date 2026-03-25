/**
 * Studio Node Types
 * 
 * Defines the data structure for graph nodes with version control support.
 */

import type { NodeRef } from './version'
import type {
  NodeContent,
  NodeType,
  InputContent,
  PromptContent,
  GeneratedContent,
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent,
  VfsRef,
  VfsMountConfig
} from './content'

// Re-export for convenience
export type { NodeContent, VfsRef, VfsMountConfig, NodeType }

// ============================================================================
// Base Node Data
// ============================================================================

/**
 * Base node data interface with version control
 * 
 * @template T - Content type (must implement NodeContent interface)
 */
export interface BaseNodeData<T extends NodeContent> {
  /** Unique node identifier (globally unique UUID, preserved on import) */
  id: string
  /** User-defined node name */
  name: string
  /** Current commit hash = computeNodeCommit(nodeId, parent, contentHash, type) */
  commit: string
  /** Content hash = SHA256(JSON.stringify(content.toJSON()))[:16] */
  contentHash: string
  /** Parent commit hash for version lineage (null for root versions) */
  parent: string | null
  /** References to historical snapshots (local only, not synced to cloud) */
  snapshotRefs: NodeRef[]
  /** Node content - implements NodeContent interface for polymorphic operations */
  content: T
  /** User-defined key-value annotations. Participates in commit hash calculation. */
  metadata?: Record<string, string>
}

// ============================================================================
// Concrete Node Types
// ============================================================================

/**
 * Input node data - represents user input that triggered generation
 */
export interface InputNodeData extends BaseNodeData<InputContent> {
  type: 'INPUT'
}

/**
 * Prompt node data - represents user-edited prompts/system prompts
 */
export interface PromptNodeData extends BaseNodeData<PromptContent> {
  type: 'PROMPT'
}

/**
 * Generated node data - represents AI-generated content
 */
export interface GeneratedNodeData extends BaseNodeData<GeneratedContent> {
  type: 'GENERATED'
}

/**
 * VFS node data - represents a virtual file system
 */
export interface VFSNodeData extends BaseNodeData<VFSContent> {
  type: 'VFS'
}

/**
 * Sandbox node data - represents a sandbox preview of VFS content
 */
export interface SandboxNodeData extends BaseNodeData<SandboxContent> {
  type: 'SANDBOX'
}

/**
 * Loader node data - Lua VM service executor
 */
export interface LoaderNodeData extends BaseNodeData<LoaderContent> {
  type: 'LOADER'
}

/**
 * State node data - represents an RDF triple store for Lua State API
 */
export interface StateNodeData extends BaseNodeData<StateContent> {
  type: 'STATE'
}

/**
 * Union type for all node data types
 */
export type StudioNodeData = InputNodeData | PromptNodeData | GeneratedNodeData | VFSNodeData | SandboxNodeData | LoaderNodeData | StateNodeData
