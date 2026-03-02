/**
 * Studio Node Types
 * 
 * Extends @pubwiki/flow-core node types with xyflow compatibility.
 * The base types come from flow-core, we only add the index signature here.
 */

import { computeNodeCommit, computeContentHash, type NodeRef } from '@pubwiki/flow-core'

// Import base types from flow-core
import {
  type BaseNodeData as FlowCoreBaseNodeData,
  type InputNodeData as FlowCoreInputNodeData,
  type PromptNodeData as FlowCorePromptNodeData,
  type GeneratedNodeData as FlowCoreGeneratedNodeData,
  type VFSNodeData as FlowCoreVFSNodeData,
  type SandboxNodeData as FlowCoreSandboxNodeData,
  type LoaderNodeData as FlowCoreLoaderNodeData,
  type StateNodeData as FlowCoreStateNodeData,
  type StudioNodeData as FlowCoreStudioNodeData,
} from '@pubwiki/flow-core'

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
// XYFlow-Compatible Node Data Types
// ============================================================================

/**
 * Adds xyflow index signature compatibility to node data
 */
type XYFlowCompatible<T> = T & { [key: string]: unknown }

/**
 * Base node data interface with xyflow compatibility
 */
export type BaseNodeData<T extends NodeContent> = XYFlowCompatible<FlowCoreBaseNodeData<T>>

// Concrete node types with xyflow compatibility
export type InputNodeData = XYFlowCompatible<FlowCoreInputNodeData>
export type PromptNodeData = XYFlowCompatible<FlowCorePromptNodeData>
export type GeneratedNodeData = XYFlowCompatible<FlowCoreGeneratedNodeData>
export type VFSNodeData = XYFlowCompatible<FlowCoreVFSNodeData>
export type SandboxNodeData = XYFlowCompatible<FlowCoreSandboxNodeData>
export type LoaderNodeData = XYFlowCompatible<FlowCoreLoaderNodeData>
export type StateNodeData = XYFlowCompatible<FlowCoreStateNodeData>

/**
 * Union type for all node data types (with xyflow compatibility)
 */
export type StudioNodeData = XYFlowCompatible<FlowCoreStudioNodeData>

/**
 * Re-export MessageBlock and related types from @pubwiki/chat for display
 */
export type { MessageBlock, MessageBlockType, ToolCallStatus } from '@pubwiki/chat'

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
  // Convert text to blocks format
  const blocks = text ? [{ type: 'TextBlock' as const, value: text }] : []
  const content = new InputContent(blocks)
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
  const commit = await computeNodeCommit(id, parent, contentHash, 'INPUT')
  return {
    id,
    name,
    type: 'INPUT',
    commit,
    contentHash,
    snapshotRefs: [],
    parent,
    content
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
  const content = PromptContent.fromText(text)
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
  const commit = await computeNodeCommit(id, parent, contentHash, 'PROMPT')
  return {
    id,
    name,
    type: 'PROMPT',
    commit,
    contentHash,
    snapshotRefs: [],
    parent,
    content
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
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
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
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
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
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
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
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
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
  const content = new StateContent(name)
  const contentHash = await computeContentHash(content.toJSON() as Parameters<typeof computeContentHash>[0])
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
