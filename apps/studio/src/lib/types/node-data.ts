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
  generateContentHash
} from '../version'
import { computeNodeCommit } from '@pubwiki/api'
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
  type NodeContent,
  type VfsRef,
  type VfsMountConfig
} from './content'

// Re-export content types and classes for external use
export type { NodeContent, VfsRef, VfsMountConfig }
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
 * In the new version control architecture:
 * - nodeId is globally unique (UUID)
 * - Importing nodes preserves original nodeId
 * - parent commit tracks version lineage
 * - No more external/originalRef distinction
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
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

// ============================================================================
// Concrete Node Types
// ============================================================================

/**
 * Input node data - represents user input that triggered generation
 * Content contains: blocks (user input text and reftags), generationConfig
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
 * Content is empty (asset VFS mounts are managed via VFSContent.mounts array)
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
  parent: string | null = null,
  name: string = ''
): Promise<InputNodeData> {
  const id = crypto.randomUUID()
  const contentHash = await generateContentHash(text)
  const commit = await computeNodeCommit(id, parent, contentHash, 'INPUT')
  // Convert text to blocks format
  const blocks = text ? [{ type: 'text' as const, value: text }] : []
  return {
    id,
    name,
    type: 'INPUT',
    commit,
    contentHash,
    snapshotRefs: [],
    parent,
    content: new InputContent(blocks)
  }
}

/**
 * Create a new prompt node data object
 */
export async function createPromptNodeData(
  text: string = '',
  parent: string | null = null,
  name: string = ''
): Promise<PromptNodeData> {
  const id = crypto.randomUUID()
  const contentHash = await generateContentHash(text)
  const commit = await computeNodeCommit(id, parent, contentHash, 'PROMPT')
  return {
    id,
    name,
    type: 'PROMPT',
    commit,
    contentHash,
    snapshotRefs: [],
    parent,
    content: PromptContent.fromText(text)
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
  parent: string | null = null,
  name: string = '',
  inputVfsRef: import('./content').VfsRef | null = null,
  outputVfsId: string | null = null,
  postGenerationCommit: string | null = null
): Promise<GeneratedNodeData> {
  const id = crypto.randomUUID()
  const content = new GeneratedContent(blocks, inputRef, promptRefs, indirectPromptRefs, inputVfsRef, outputVfsId, postGenerationCommit)
  const contentHash = await generateContentHash(content.serialize())
  const commit = await computeNodeCommit(id, parent, contentHash, 'GENERATED')
  return {
    id,
    name,
    type: 'GENERATED',
    commit,
    contentHash,
    snapshotRefs: [],
    parent,
    content
  }
}

/**
 * Create a new VFS node data object
 * 
 * @param projectId - The project ID for the VFS
 * @param name - Display name shown on the node (node-data.name), also used as the VFS identifier
 */
export async function createVFSNodeData(
  projectId: string,
  name: string = 'Files'
): Promise<VFSNodeData> {
  const id = crypto.randomUUID()
  const content = new VFSContent(projectId)
  const contentHash = await generateContentHash(content.serialize())
  const commit = await computeNodeCommit(id, null, contentHash, 'VFS')
  return {
    id,
    name,
    type: 'VFS',
    commit,
    contentHash,
    snapshotRefs: [],
    parent: null,
    content
  }
}

/**
 * Create a new Sandbox node data object
 */
export async function createSandboxNodeData(
  name: string = 'Preview'
): Promise<SandboxNodeData> {
  const id = crypto.randomUUID()
  const content = new SandboxContent('index.html')
  const contentHash = await generateContentHash(content.serialize())
  const commit = await computeNodeCommit(id, null, contentHash, 'SANDBOX')
  return {
    id,
    name,
    type: 'SANDBOX',
    commit,
    contentHash,
    snapshotRefs: [],
    parent: null,
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
  const content = new LoaderContent()
  const contentHash = await generateContentHash(content.serialize())
  const commit = await computeNodeCommit(id, null, contentHash, 'LOADER')
  return {
    id,
    name,
    type: 'LOADER',
    commit,
    contentHash,
    snapshotRefs: [],
    parent: null,
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
  const contentHash = await generateContentHash(content.serialize())
  const commit = await computeNodeCommit(id, null, contentHash, 'STATE')
  return {
    id,
    name,
    type: 'STATE',
    commit,
    contentHash,
    snapshotRefs: [],
    parent: null,
    content
  }
}
