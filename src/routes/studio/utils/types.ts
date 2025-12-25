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
  /** User-defined node name */
  name: string
  /** Current commit hash (content hash) */
  commit: string
  /** References to historical snapshots (stored in global snapshotStore) */
  snapshotRefs: NodeRef[]
  /** Parent nodes that contributed to this node's creation */
  parents: NodeRef[]
  /** Node content */
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
 * Content is string (user text input)
 * Prompts are connected via @tag references in content
 * VFS mounts are managed via mountpoints array (not in text)
 */
export interface InputNodeData extends BaseNodeData<string> {
  type: 'INPUT'
  /** VFS mount paths - each path like '/src' represents a mountpoint handle */
  mountpoints: string[]
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
 * VFS node data - represents a virtual file system
 * Content is an empty string (actual file content is stored in VFS, versioned by git)
 */
export interface VFSNodeData extends BaseNodeData<string> {
  type: 'VFS'
  /** Project ID for VFS isolation */
  projectId: string
  /** UI State: Expanded folder paths (persisted) */
  expandedFolders?: string[]
  /** UI State: Currently selected file path (persisted) */
  selectedFilePath?: string
  /** UI State: Whether expanded view is open (persisted) */
  isExpandedViewOpen?: boolean
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

/**
 * Sandbox node data - represents a sandbox preview of VFS content
 * Content is an empty string (preview is rendered in iframe)
 */
export interface SandboxNodeData extends BaseNodeData<string> {
  type: 'SANDBOX'
  /** Entry file path for the sandbox (e.g., '/app.tsx') */
  entryFile: string
  /** Whether the sandbox is currently running */
  isRunning: boolean
  /** Current error message (if any) */
  error: string | null
  /** Sandbox site URL */
  sandboxOrigin: string
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

/**
 * Loader node data - represents a custom service provider
 * Content is an empty string (service is provided via RPC)
 */
export interface LoaderNodeData extends BaseNodeData<string> {
  type: 'LOADER'
  /** 
   * Service type identifier
   * Each Loader has a specific serviceType, e.g., 'echo', 'wikirag', 'analytics'
   */
  serviceType: string
  /**
   * Service configuration (JSON string)
   * Each serviceType has its specific config structure
   */
  config: string
  /**
   * Whether the service is currently active/ready
   */
  isActive: boolean
  /**
   * Error state if service initialization failed
   */
  error: string | null
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

/**
 * State node data - represents an RDF triple store for Lua State API
 * Content is an empty string (actual data is stored in quadstore via IndexedDB)
 * Implements RDFStore interface from @pubwiki/lua
 */
export interface StateNodeData extends BaseNodeData<string> {
  type: 'STATE'
  /**
   * Whether the RDF store is currently open and ready
   */
  isReady: boolean
  /**
   * Error state if store initialization failed
   */
  error: string | null
  /**
   * Number of triples currently in the store (for display)
   */
  tripleCount: number
  /** Index signature for xyflow compatibility */
  [key: string]: unknown
}

/**
 * Union type for all node data types
 */
export type StudioNodeData = InputNodeData | PromptNodeData | GeneratedNodeData | VFSNodeData | SandboxNodeData | LoaderNodeData | StateNodeData

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Create a new input node data object
 */
export async function createInputNodeData(
  content: string,
  parents: NodeRef[] = [],
  name: string = '',
  mountpoints: string[] = []
): Promise<InputNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(content)
  return {
    id,
    name,
    type: 'INPUT',
    commit,
    snapshotRefs: [],
    parents,
    content,
    mountpoints
  }
}

/**
 * Create a new prompt node data object
 */
export async function createPromptNodeData(
  content: string = '',
  parents: NodeRef[] = [],
  name: string = ''
): Promise<PromptNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(content)
  return {
    id,
    name,
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
  parents: NodeRef[] = [],
  name: string = ''
): Promise<GeneratedNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash(content)
  return {
    id,
    name,
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
 * Create a new VFS node data object
 */
export async function createVFSNodeData(
  projectId: string,
  name: string = 'Files'
): Promise<VFSNodeData> {
  const id = crypto.randomUUID()
  // VFS nodes don't have traditional content - use empty string for commit hash
  // The actual file content is stored in VFS and versioned by git
  const commit = await generateCommitHash('')
  return {
    id,
    name,
    type: 'VFS',
    commit,
    snapshotRefs: [],
    parents: [],
    content: '',
    projectId,
    expandedFolders: [],
    selectedFilePath: undefined,
    isExpandedViewOpen: false
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
  const commit = await generateCommitHash('')
  return {
    id,
    name,
    type: 'SANDBOX',
    commit,
    snapshotRefs: [],
    parents: [],
    content: '',
    entryFile: 'index.html',
    isRunning: false,
    error: null,
    sandboxOrigin
  }
}

/**
 * Available service types for Loader nodes
 */
export const LOADER_SERVICE_TYPES = ['echo', 'counter', 'wikirag'] as const
export type LoaderServiceType = typeof LOADER_SERVICE_TYPES[number]

/**
 * Create a new Loader node data object
 */
export async function createLoaderNodeData(
  serviceType: LoaderServiceType = 'echo',
  name: string = 'Service',
  config: string = '{}'
): Promise<LoaderNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash('')
  return {
    id,
    name,
    type: 'LOADER',
    commit,
    snapshotRefs: [],
    parents: [],
    content: '',
    serviceType,
    config,
    isActive: false,
    error: null
  }
}

/**
 * Create a new State node data object (RDF triple store)
 */
export async function createStateNodeData(
  name: string = 'State'
): Promise<StateNodeData> {
  const id = crypto.randomUUID()
  const commit = await generateCommitHash('')
  return {
    id,
    name,
    type: 'STATE',
    commit,
    snapshotRefs: [],
    parents: [],
    content: '',
    isReady: false,
    error: null,
    tripleCount: 0
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
      name: nodeData.name,
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
    name: nodeData.name,
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
