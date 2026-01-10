/**
 * Studio Node Types
 * 
 * Defines the data structure for graph nodes with version control support.
 * 
 * Design Philosophy:
 * - `content` field contains ALL persistent data that needs to be:
 *   - Stored in IndexedDB
 *   - Snapshotted for version control
 *   - Published to backend
 * - UI/runtime states (isEditing, isStreaming, error, etc.) are separate fields
 * - Content types are defined in content-types.ts
 * 
 * Note: Version control types (NodeRef, NodeSnapshot, etc.) are in stores/version/
 */

import { 
  type NodeRef, 
  type SnapshotPosition,
  generateCommitHash
} from '../version'
import type { Edge, Node } from '@xyflow/svelte'

// Import content classes for use in factory functions
import {
  InputContent,
  PromptContent,
  GeneratedContent,
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent,
  restoreContent,
  type Mountpoint,
  type NodeContent
} from './content'

// Re-export content types and classes for external use
export type { Mountpoint, NodeContent }
export {
  InputContent,
  PromptContent,
  GeneratedContent,
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent,
  restoreContent
}

// ============================================================================
// Base Node Data
// ============================================================================

/**
 * Base node data interface with version control
 * 
 * Contains ONLY persistent data that should be:
 * - Stored in IndexedDB
 * - Snapshotted for version control
 * - Published to backend
 * 
 * Runtime/UI states should be managed in the component's local state.
 * 
 * @template T - Content type (must implement NodeContent interface)
 */
export interface BaseNodeData<T extends NodeContent> {
  /** Unique node identifier */
  id: string
  /** User-defined node name */
  name: string
  /** Current commit hash (content hash) */
  commit: string
  /** References to historical snapshots */
  snapshotRefs: NodeRef[]
  /** Parent nodes that contributed to this node's creation */
  parents: NodeRef[]
  /** Node content - implements NodeContent interface for polymorphic operations */
  content: T
  /** Whether this node references external artifact (not included in export) */
  external?: boolean
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

// ============================================================================
// Concrete Node Types
// ============================================================================

/**
 * Input node data - represents user input that triggered generation
 * Content contains: text (user input) and mountpoints (VFS mount configuration)
 */
export interface InputNodeData extends BaseNodeData<InputContent> {
  type: 'INPUT'
}

/**
 * Prompt node data - represents user-edited prompts/system prompts
 * Content contains: text (prompt text)
 */
export interface PromptNodeData extends BaseNodeData<PromptContent> {
  type: 'PROMPT'
}

/**
 * Re-export MessageBlock and related types from @pubwiki/chat for display
 */
export type { MessageBlock, MessageBlockType, ToolCallStatus } from '@pubwiki/chat'

/**
 * Generated node data - represents AI-generated content
 * Content contains: blocks (MessageBlock[]), inputRef, promptRefs, indirectPromptRefs
 */
export interface GeneratedNodeData extends BaseNodeData<GeneratedContent> {
  type: 'GENERATED'
}

/**
 * VFS node data - represents a virtual file system
 * Content contains: projectId
 * Actual file content is stored in VFS and versioned by git
 */
export interface VFSNodeData extends BaseNodeData<VFSContent> {
  type: 'VFS'
}

/**
 * Sandbox node data - represents a sandbox preview of VFS content
 * Content contains: entryFile, sandboxOrigin
 */
export interface SandboxNodeData extends BaseNodeData<SandboxContent> {
  type: 'SANDBOX'
}

/**
 * Loader node data - Lua VM service executor
 * Content contains: mountpoints
 */
export interface LoaderNodeData extends BaseNodeData<LoaderContent> {
  type: 'LOADER'
}

/**
 * State node data - represents an RDF triple store for Lua State API
 * Content is empty (actual data is stored in quadstore via IndexedDB)
 */
export interface StateNodeData extends BaseNodeData<StateContent> {
  type: 'STATE'
}

/**
 * Union type for all node data types
 */
export type StudioNodeData = InputNodeData | PromptNodeData | GeneratedNodeData | VFSNodeData | SandboxNodeData | LoaderNodeData | StateNodeData

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new input node data object
 */
export async function createInputNodeData(
  text: string,
  parents: NodeRef[] = [],
  name: string = '',
  mountpoints: Mountpoint[] = []
): Promise<InputNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(text)
  return {
    id,
    name,
    type: 'INPUT',
    commit,
    snapshotRefs: [],
    parents,
    content: new InputContent(text, mountpoints)
  }
}

/**
 * Create a new prompt node data object
 */
export async function createPromptNodeData(
  text: string = '',
  parents: NodeRef[] = [],
  name: string = ''
): Promise<PromptNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(text)
  return {
    id,
    name,
    type: 'PROMPT',
    commit,
    snapshotRefs: [],
    parents,
    content: new PromptContent(text)
  }
}

/**
 * Create a new generated node data object
 */
export async function createGeneratedNodeData(
  blocks: import('@pubwiki/chat').MessageBlock[] = [],
  inputRef: NodeRef,
  promptRefs: NodeRef[],
  indirectPromptRefs: NodeRef[] = [],
  parents: NodeRef[] = [],
  name: string = ''
): Promise<GeneratedNodeData> {
  const id = crypto.randomUUID()
  const content = new GeneratedContent(blocks, inputRef, promptRefs, indirectPromptRefs)
  const commit = await generateCommitHash(content.serialize())
  return {
    id,
    name,
    type: 'GENERATED',
    commit,
    snapshotRefs: [],
    parents,
    content
  }
}

/**
 * Create a new VFS node data object
 */
export async function createVFSNodeData(
  projectId: string,
  name: string = 'Files'
): Promise<VFSNodeData> {
  const id = crypto.randomUUID()
  const content = new VFSContent(projectId)
  const commit = await generateCommitHash(content.serialize())
  return {
    id,
    name,
    type: 'VFS',
    commit,
    snapshotRefs: [],
    parents: [],
    content
  }
}

/**
 * Create a new Sandbox node data object
 */
export async function createSandboxNodeData(
  name: string = 'Preview',
  sandboxOrigin: string = 'http://localhost:4001'
): Promise<SandboxNodeData> {
  const id = crypto.randomUUID()
  const content = new SandboxContent('index.html', sandboxOrigin)
  const commit = await generateCommitHash(content.serialize())
  return {
    id,
    name,
    type: 'SANDBOX',
    commit,
    snapshotRefs: [],
    parents: [],
    content
  }
}

/**
 * Create a new Loader node data object (Lua VM service executor)
 */
export async function createLoaderNodeData(
  name: string = 'Services'
): Promise<LoaderNodeData> {
  const id = crypto.randomUUID()
  const content = new LoaderContent([])
  const commit = await generateCommitHash(content.serialize())
  return {
    id,
    name,
    type: 'LOADER',
    commit,
    snapshotRefs: [],
    parents: [],
    content
  }
}

/**
 * Create a new State node data object (RDF triple store)
 */
export async function createStateNodeData(
  name: string = 'State'
): Promise<StateNodeData> {
  const id = crypto.randomUUID()
  const content = new StateContent()
  const commit = await generateCommitHash(content.serialize())
  return {
    id,
    name,
    type: 'STATE',
    commit,
    snapshotRefs: [],
    parents: [],
    content
  }
}
