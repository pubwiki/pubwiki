/**
 * Connection Type System
 * 
 * Defines the type system for node connections.
 * Provides type-safe handle definitions and connection validation.
 */

import type { StudioNodeData } from '../types/node'
import type { GraphEdge } from '../types/edge'

// ============================================================================
// Data Types
// ============================================================================

/**
 * Data types that can be passed between nodes
 */
export const DataType = {
  /** String content (prompt, input, generated text) */
  STRING: 'string',
  /** Virtual file system reference */
  VFS: 'vfs',
  /** Service provider reference */
  SERVICE: 'service',
  /** RDF state store reference */
  STATE: 'state',
} as const

export type DataType = typeof DataType[keyof typeof DataType]

// ============================================================================
// Cardinality
// ============================================================================

/**
 * Connection cardinality for handles
 */
export const Cardinality = {
  /** Optional single connection (0-1) */
  OPTIONAL: 'optional',
  /** Multiple connections allowed (0-N) */
  MANY: 'many',
} as const

export type Cardinality = typeof Cardinality[keyof typeof Cardinality]

// ============================================================================
// Handle IDs
// ============================================================================

/**
 * Handle ID constants - all handle IDs are defined here
 */
export const HandleId = {
  /** Default handle for simple connections */
  DEFAULT: 'default',
  /** VFS input on Sandbox/Input node */
  VFS_INPUT: 'vfs-input',
  /** VFS mount input - for mounting child VFS into parent VFS */
  VFS_MOUNT: 'vfs-mount',
  /** Service input on Sandbox node */
  SERVICE_INPUT: 'service-input',
  /** RefTag handle prefix for dynamic handles (for prompts) */
  REFTAG_PREFIX: 'reftag-',
  /** System prompt input on Input node */
  SYSTEM_TAG: 'system-prompt',
  /** Tag handle prefix for generic tagged handles */
  TAG_PREFIX: 'tag-',
  /** Loader Node: Backend VFS input (single) */
  LOADER_BACKEND: 'loader-backend',
  /** Loader Node: Asset VFS input (multiple) */
  LOADER_ASSET_VFS: 'loader-asset-vfs',
  /** Loader Node: State input */
  LOADER_STATE: 'loader-state',
  /** Loader Node: Service output */
  LOADER_OUTPUT: 'loader-output',
  /** Loader Node: Documentation VFS output */
  LOADER_DOCS_OUTPUT: 'loader-docs-output',
  /** Generated Node: VFS output */
  VFS_OUTPUT: 'vfs-output',
  /** VFS mount handle prefix for dynamic mount handles */
  VFS_MOUNT_PREFIX: 'vfs-mount-',
  /** VFS generator input */
  VFS_GENERATOR_INPUT: 'vfs-generator',
} as const

// ============================================================================
// Handle Specification
// ============================================================================

/**
 * Handle specification defining connection capabilities
 */
export interface HandleSpec {
  /** Handle unique identifier */
  id: string
  /** Display label */
  label: string
  /** Data type this handle accepts/provides */
  dataType: DataType
  /** Connection cardinality */
  cardinality: Cardinality
  /** Whether this is a dynamic handle (like reftag-*) */
  dynamic?: boolean
}

// ============================================================================
// Node Specification
// ============================================================================

/**
 * Node specification defining connection behavior
 */
export interface NodeSpec {
  /** Node type identifier */
  type: string
  /** Display label */
  label: string
  /** Input handle specifications */
  inputs: HandleSpec[]
  /** Output handle specifications */
  outputs: HandleSpec[]
  /** Whether users can manually create input connections */
  manualInput: boolean
  /** Whether users can manually create output connections */
  manualOutput: boolean
}

// ============================================================================
// Node Registry
// ============================================================================

/**
 * Registry of all node specifications
 */
export const NodeRegistry: Record<string, NodeSpec> = {
  PROMPT: {
    type: 'PROMPT',
    label: 'Prompt',
    inputs: [
      {
        id: HandleId.REFTAG_PREFIX,
        label: 'RefTag',
        dataType: DataType.STRING,
        cardinality: Cardinality.OPTIONAL,
        dynamic: true,
      },
    ],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Output',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
      },
    ],
    manualInput: true,
    manualOutput: true,
  },

  INPUT: {
    type: 'INPUT',
    label: 'Input',
    inputs: [
      {
        id: HandleId.VFS_INPUT,
        label: 'VFS',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
      },
      {
        id: HandleId.SYSTEM_TAG,
        label: 'System Prompt',
        dataType: DataType.STRING,
        cardinality: Cardinality.OPTIONAL,
      },
      {
        id: HandleId.TAG_PREFIX,
        label: 'Tag',
        dataType: DataType.STRING,
        cardinality: Cardinality.OPTIONAL,
        dynamic: true,
      },
    ],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Output',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
      },
    ],
    manualInput: true,
    manualOutput: false,
  },

  GENERATED: {
    type: 'GENERATED',
    label: 'Generated',
    inputs: [],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Output',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
      },
    ],
    manualInput: false,
    manualOutput: true,
  },

  VFS: {
    type: 'VFS',
    label: 'VFS',
    inputs: [
      {
        id: HandleId.VFS_GENERATOR_INPUT,
        label: 'Loader',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
      },
      {
        id: HandleId.VFS_MOUNT_PREFIX,
        label: 'Mount',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
        dynamic: true,
      },
    ],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'VFS Output',
        dataType: DataType.VFS,
        cardinality: Cardinality.MANY,
      },
    ],
    manualInput: true,
    manualOutput: true,
  },

  SANDBOX: {
    type: 'SANDBOX',
    label: 'Sandbox',
    inputs: [
      {
        id: HandleId.VFS_INPUT,
        label: 'VFS',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
      },
      {
        id: HandleId.SERVICE_INPUT,
        label: 'Services',
        dataType: DataType.SERVICE,
        cardinality: Cardinality.MANY,
      },
    ],
    outputs: [],
    manualInput: true,
    manualOutput: false,
  },

  LOADER: {
    type: 'LOADER',
    label: 'Loader',
    inputs: [
      {
        id: HandleId.LOADER_BACKEND,
        label: 'Backend',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
      },
      {
        id: HandleId.LOADER_STATE,
        label: 'State',
        dataType: DataType.STATE,
        cardinality: Cardinality.OPTIONAL,
      },
      {
        id: HandleId.LOADER_ASSET_VFS,
        label: 'Assets',
        dataType: DataType.VFS,
        cardinality: Cardinality.MANY,
      },
    ],
    outputs: [
      {
        id: HandleId.LOADER_OUTPUT,
        label: 'Service Output',
        dataType: DataType.SERVICE,
        cardinality: Cardinality.MANY,
      },
      {
        id: HandleId.LOADER_DOCS_OUTPUT,
        label: 'Docs Output',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
      },
    ],
    manualInput: true,
    manualOutput: true,
  },

  STATE: {
    type: 'STATE',
    label: 'State',
    inputs: [],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'State Output',
        dataType: DataType.STATE,
        cardinality: Cardinality.MANY,
      },
    ],
    manualInput: false,
    manualOutput: true,
  },
}

// ============================================================================
// Registry Accessors
// ============================================================================

/**
 * Get node specification by type
 */
export function getNodeSpec(nodeType: string): NodeSpec | undefined {
  return NodeRegistry[nodeType]
}

/**
 * Get handle specification
 */
export function getHandleSpec(
  nodeType: string,
  handleId: string,
  direction: 'input' | 'output'
): HandleSpec | undefined {
  const nodeSpec = getNodeSpec(nodeType)
  if (!nodeSpec) return undefined

  const handles = direction === 'input' ? nodeSpec.inputs : nodeSpec.outputs

  // Exact match
  const exact = handles.find(h => h.id === handleId)
  if (exact) return exact

  // Dynamic handle match
  let bestMatch: HandleSpec | undefined
  let bestMatchLength = 0
  
  for (const handle of handles) {
    if (handle.dynamic && handleId.startsWith(handle.id)) {
      if (handle.id.length > bestMatchLength) {
        bestMatch = handle
        bestMatchLength = handle.id.length
      }
    }
  }

  return bestMatch
}

// ============================================================================
// RefTag Helpers
// ============================================================================

export function isRefTagHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(HandleId.REFTAG_PREFIX)
}

export function getRefTagName(handleId: string): string {
  return handleId.slice(HandleId.REFTAG_PREFIX.length)
}

export function createRefTagHandleId(tagName: string): string {
  return `${HandleId.REFTAG_PREFIX}${tagName}`
}

// ============================================================================
// Tag Handle Helpers
// ============================================================================

export function isTagHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(HandleId.TAG_PREFIX)
}

export function getTagName(handleId: string): string {
  return handleId.slice(HandleId.TAG_PREFIX.length)
}

export function createTagHandleId(tagName: string): string {
  return `${HandleId.TAG_PREFIX}${tagName}`
}

// ============================================================================
// VFS Mount Handle Helpers
// ============================================================================

export function isVfsMountHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(HandleId.VFS_MOUNT_PREFIX)
}

export function getMountIdFromHandle(handleId: string): string {
  return handleId.slice(HandleId.VFS_MOUNT_PREFIX.length)
}

export function createVfsMountHandleId(mountId: string): string {
  return `${HandleId.VFS_MOUNT_PREFIX}${mountId}`
}

// ============================================================================
// Connection Validation
// ============================================================================

export interface ConnectionParams {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface ValidationResult {
  valid: boolean
  reason?: string
}

function isDataTypeCompatible(sourceType: DataType, targetType: DataType): boolean {
  return sourceType === targetType
}

function canAddConnection(cardinality: Cardinality, currentCount: number): boolean {
  switch (cardinality) {
    case Cardinality.OPTIONAL:
      return currentCount === 0
    case Cardinality.MANY:
      return true
    default:
      return false
  }
}

/**
 * Validate a connection between nodes
 */
export function validateConnection(
  connection: ConnectionParams,
  getNodeType: (nodeId: string) => string | undefined,
  existingEdges: ConnectionParams[]
): ValidationResult {
  const sourceType = getNodeType(connection.source)
  const targetType = getNodeType(connection.target)

  if (!sourceType || !targetType) {
    return { valid: false, reason: 'Node not found' }
  }

  const sourceSpec = getNodeSpec(sourceType)
  const targetSpec = getNodeSpec(targetType)

  if (!sourceSpec || !targetSpec) {
    return { valid: false, reason: 'Unknown node type' }
  }

  // Check manual connection permissions
  if (!targetSpec.manualInput) {
    return { valid: false, reason: `${targetType} does not accept manual connections` }
  }

  if (!sourceSpec.manualOutput) {
    return { valid: false, reason: `${sourceType} does not allow manual output connections` }
  }

  const sourceHandleId = connection.sourceHandle ?? HandleId.DEFAULT
  const targetHandleId = connection.targetHandle ?? HandleId.DEFAULT

  // Get handle specs
  const sourceHandleSpec = getHandleSpec(sourceType, sourceHandleId, 'output')
  const targetHandleSpec = getHandleSpec(targetType, targetHandleId, 'input')

  if (!sourceHandleSpec) {
    return { valid: false, reason: `Invalid source handle: ${sourceHandleId}` }
  }

  if (!targetHandleSpec) {
    return { valid: false, reason: `Invalid target handle: ${targetHandleId}` }
  }

  // Check data type compatibility
  if (!isDataTypeCompatible(sourceHandleSpec.dataType, targetHandleSpec.dataType)) {
    return {
      valid: false,
      reason: `Type mismatch: ${sourceHandleSpec.dataType} cannot connect to ${targetHandleSpec.dataType}`,
    }
  }

  // Check cardinality
  const existingToHandle = existingEdges.filter(
    e => e.target === connection.target && 
         (e.targetHandle ?? HandleId.DEFAULT) === targetHandleId
  )

  if (!canAddConnection(targetHandleSpec.cardinality, existingToHandle.length)) {
    return {
      valid: false,
      reason: `${targetHandleSpec.label} already has a connection`,
    }
  }

  // Prevent self-connection
  if (connection.source === connection.target) {
    return { valid: false, reason: 'Self-connection not allowed' }
  }

  return { valid: true }
}
