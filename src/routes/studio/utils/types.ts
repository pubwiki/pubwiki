/**
 * Studio Node Types
 * 
 * Defines the data structure for graph nodes with version control support.
 * Uses a generic GraphNodeData<T> design where T is the content type.
 * 
 * Note: Version control types (NodeRef, NodeSnapshot, etc.) are now in stores/version/
 */

import { 
  type NodeRef, 
  type SnapshotPosition,
  generateCommitHash
} from '../stores/version'
import type { Edge, Node } from '@xyflow/svelte'

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
 * Mountpoint definition with stable ID for handle identification
 */
export interface Mountpoint {
  /** Stable random ID used for handle identification */
  id: string
  /** User-editable mount path like '/src' */
  path: string
}

/**
 * Input node data - represents user input that triggered generation
 * Content is string (user text input)
 * Prompts are connected via @tag references in content
 * VFS mounts are managed via mountpoints array (not in text)
 */
export interface InputNodeData extends BaseNodeData<string> {
  type: 'INPUT'
  /** VFS mountpoints - each has a stable ID and editable path */
  mountpoints: Mountpoint[]
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
 * Tool call status type for streaming display
 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error'

/**
 * Tool call state for display during streaming
 */
export interface ToolCallState {
  /** Tool call ID */
  id: string
  /** Tool name */
  name: string
  /** Tool arguments */
  args: unknown
  /** Tool call status */
  status: ToolCallStatus
  /** Tool result (when completed) */
  result?: unknown
  /** Error message (when error) */
  error?: string
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
  /** Active tool calls during streaming */
  toolCalls?: ToolCallState[]
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
 * Loader node data - Lua VM service executor
 * Content is an empty string (service is provided via Lua VM)
 */
export interface LoaderNodeData extends BaseNodeData<string> {
  type: 'LOADER'
  /**
   * Lua VM state
   * - 'idle': Not loaded, waiting for user to click Load
   * - 'loading': Initializing VM and executing init.lua
   * - 'ready': Services registered, ready to call
   * - 'error': Initialization failed
   */
  vmState: 'idle' | 'loading' | 'ready' | 'error'
  /**
   * Error message (if any)
   */
  error: string | null
  /**
   * Registered services list (from ServiceRegistry)
   * Format: ['namespace:name', ...]
   */
  registeredServices: string[]
  /**
   * VFS mountpoints (similar to InputNode's mountpoints)
   * Mounted to /user/assets/{path}
   */
  mountpoints: Mountpoint[]
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
  mountpoints: Mountpoint[] = []
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
    isStreaming: false,
    toolCalls: []
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
 * Create a new Loader node data object (Lua VM service executor)
 */
export async function createLoaderNodeData(
  name: string = 'Services'
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
    vmState: 'idle',
    error: null,
    registeredServices: [],
    mountpoints: []
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
