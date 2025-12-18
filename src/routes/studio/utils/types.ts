/**
 * Studio Node Types
 * 
 * Defines the data structure for graph nodes with version control support.
 * Uses a generic GraphNodeData<T> design where T is the content type.
 */

import { 
  type NodeRef, 
  type NodeSnapshot, 
  type SnapshotEdge,
  type SnapshotPosition,
  snapshotStore, 
  generateCommitHash,
} from '../stores/snapshot'
import type { Edge, Node } from '@xyflow/svelte'

// Re-export snapshot store types and utilities
export { type NodeRef, type NodeSnapshot, type SnapshotEdge, snapshotStore, generateCommitHash }

// ============================================================================
// Base Node Data (Generic)
// ============================================================================

/**
 * Base node data interface with version control
 * @template T - Content type
 */
export interface BaseNodeData<T = unknown> {
  /** Unique node identifier */
  id: string
  /** Current commit hash (content hash) */
  commit: string
  /** References to historical snapshots (stored in global snapshotStore) */
  snapshotRefs: NodeRef[]
  /** Parent nodes that contributed to this node's creation */
  parents: NodeRef[]
  /** Node content */
  content: T
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

// ============================================================================
// Concrete Node Types
// ============================================================================

/**
 * Input node data - represents user input that triggered generation
 * Content is string (user text input)
 */
export interface InputNodeData extends BaseNodeData<string> {
  type: 'INPUT'
  /** IDs of prompt nodes that were selected when this input was created */
  sourcePromptIds: string[]
}

/**
 * Prompt node data - represents user-edited prompts/system prompts
 * Content is string (prompt text)
 */
export interface PromptNodeData extends BaseNodeData<string> {
  type: 'PROMPT'
  /** Whether this node is currently being edited */
  isEditing?: boolean
}

/**
 * Generated node data - represents AI-generated content
 * Content is string (generated text)
 */
export interface GeneratedNodeData extends BaseNodeData<string> {
  type: 'GENERATED'
  /** Reference to the input node that triggered this generation */
  inputRef: NodeRef
  /** References to the direct prompt nodes used in generation */
  promptRefs: NodeRef[]
  /** References to indirect prompts (resolved via reftags) */
  indirectPromptRefs: NodeRef[]
  /** Whether content is being streamed into this node */
  isStreaming?: boolean
}

/**
 * Union type for all node data types
 */
export type StudioNodeData = InputNodeData | PromptNodeData | GeneratedNodeData

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a new input node data object
 */
export async function createInputNodeData(
  content: string,
  sourcePromptIds: string[],
  parents: NodeRef[] = []
): Promise<InputNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(content)
  return {
    id,
    type: 'INPUT',
    commit,
    snapshotRefs: [],
    parents,
    content,
    sourcePromptIds
  }
}

/**
 * Create a new prompt node data object
 */
export async function createPromptNodeData(
  content: string = '',
  parents: NodeRef[] = []
): Promise<PromptNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(content)
  return {
    id,
    type: 'PROMPT',
    commit,
    snapshotRefs: [],
    parents,
    content,
    isEditing: false
  }
}

/**
 * Create a new generated node data object
 */
export async function createGeneratedNodeData(
  content: string = '',
  inputRef: NodeRef,
  promptRefs: NodeRef[],
  indirectPromptRefs: NodeRef[] = [],
  parents: NodeRef[] = []
): Promise<GeneratedNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(content)
  return {
    id,
    type: 'GENERATED',
    commit,
    snapshotRefs: [],
    parents,
    content,
    inputRef,
    promptRefs,
    indirectPromptRefs,
    isStreaming: false
  }
}

/**
 * Sync node's commit hash with its current content and save snapshot.
 * 
 * This function:
 * 1. Saves the current version to snapshot store (with edges and position)
 * 2. If content has changed, updates the commit hash
 * 
 * @param node - The full node object (including position)
 * @param edges - All edges in the graph (to save incoming connections)
 */
export async function syncNode<T extends BaseNodeData<C>, C>(
  node: Node<T>,
  edges: Edge[]
): Promise<T> {
  const nodeData = node.data;
  const position: SnapshotPosition | undefined = node.position 
    ? { x: node.position.x, y: node.position.y }
    : undefined;
  
  const currentContentHash = await generateCommitHash(nodeData.content)
  
  // If commit matches current content, save snapshot with current commit and return
  if (currentContentHash === nodeData.commit) {
    // Save current version (idempotent - won't save if already exists)
    saveCurrentVersion(nodeData, edges, position);
    return nodeData
  }
  
  // Content has changed - the old commit doesn't match current content
  // Save snapshot of OLD version first (before we update the commit)
  saveCurrentVersion(nodeData, edges, position);
  
  // Create ref to the old version
  const snapshotRef: NodeRef = {
    id: nodeData.id,
    commit: nodeData.commit
  }
  
  // Create updated node data with new commit matching current content
  const updatedNodeData: T = {
    ...nodeData,
    commit: currentContentHash,
    snapshotRefs: [...nodeData.snapshotRefs, snapshotRef]
  }
  
  // Also save snapshot with the NEW commit (current content)
  // This ensures promptRefs can find the snapshot
  saveCurrentVersion(updatedNodeData, edges, position);
  
  return updatedNodeData
}

/**
 * Extract incoming edges for a node, converting to SnapshotEdge format
 */
export function getIncomingEdges(nodeId: string, edges: Edge[]): SnapshotEdge[] {
  return edges
    .filter(e => e.target === nodeId)
    .map(e => ({
      source: e.source,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle
    }))
}

/**
 * Save current node state to snapshot store.
 * Call this BEFORE the user edits the content to preserve the current version.
 * @param nodeData - The node data to save
 * @param edges - Optional: all edges in the graph (to save incoming connections)
 * @param position - Optional: node position at time of save
 * @internal Used by syncNode - prefer using syncNode directly
 */
function saveCurrentVersion<T extends BaseNodeData<C>, C>(
  nodeData: T,
  edges?: Edge[],
  position?: SnapshotPosition
): void {
  // Only save if not already in store
  if (!snapshotStore.has(nodeData.id, nodeData.commit)) {
    const incomingEdges = edges ? getIncomingEdges(nodeData.id, edges) : undefined
    const snapshot: NodeSnapshot<C> = {
      nodeId: nodeData.id,
      commit: nodeData.commit,
      content: nodeData.content as C,
      timestamp: Date.now(),
      incomingEdges,
      position
    }
    snapshotStore.add(snapshot)
  }
}

/**
 * Restore node to a specific snapshot version
 */
export function restoreSnapshot<T extends BaseNodeData<C>, C>(
  nodeData: T,
  snapshotRef: NodeRef
): T | null {
  const snapshot = snapshotStore.get<C>(snapshotRef.id, snapshotRef.commit)
  if (!snapshot) {
    return null
  }
  
  // Store current version as snapshot before restoring
  const currentSnapshot: NodeSnapshot<C> = {
    nodeId: nodeData.id,
    commit: nodeData.commit,
    content: nodeData.content as C,
    timestamp: Date.now()
  }
  snapshotStore.add(currentSnapshot)
  
  const currentRef: NodeRef = {
    id: nodeData.id,
    commit: nodeData.commit
  }
  
  return {
    ...nodeData,
    content: snapshot.content,
    commit: snapshot.commit,
    snapshotRefs: [...nodeData.snapshotRefs, currentRef]
  }
}

/**
 * Check if a node has version history
 */
export function hasVersionHistory(nodeData: BaseNodeData): boolean {
  return nodeData.snapshotRefs.length > 0
}

/**
 * Get the number of versions (current + snapshots)
 */
export function getVersionCount(nodeData: BaseNodeData): number {
  return nodeData.snapshotRefs.length + 1
}

/**
 * Get all snapshots for a node from the store
 */
export function getNodeSnapshots<T>(nodeData: BaseNodeData<T>): NodeSnapshot<T>[] {
  return snapshotStore.getByNodeId<T>(nodeData.id)
}
