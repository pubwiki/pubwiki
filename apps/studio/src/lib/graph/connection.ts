/**
 * Connection Type System
 * 
 * Defines the type system for node connections in Studio.
 * Provides type-safe handle definitions and connection validation.
 */

import type { InputNodeData, StudioNodeData } from '../types';

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
} as const;

export type DataType = typeof DataType[keyof typeof DataType];

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
} as const;

export type Cardinality = typeof Cardinality[keyof typeof Cardinality];

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
  /** System prompt input on Input node (always present, independent ID to avoid conflict with user @system tag) */
  SYSTEM_TAG: 'system-prompt',
  /** Tag handle prefix for generic tagged handles */
  TAG_PREFIX: 'tag-',
  /** Loader Node: Backend VFS input (single) */
  LOADER_BACKEND: 'loader-backend',
  /** Loader Node: Asset VFS input (multiple) - VFS mounts are configured on VFS nodes */
  LOADER_ASSET_VFS: 'loader-asset-vfs',
  /** Loader Node: State input (connects to State node for RDF store) */
  LOADER_STATE: 'loader-state',
  /** Loader Node: Service output */
  LOADER_OUTPUT: 'loader-output',
  /** Loader Node: Documentation VFS output */
  LOADER_DOCS_OUTPUT: 'loader-docs-output',
  /** Generated Node: VFS output (for file creation/modification) */
  VFS_OUTPUT: 'vfs-output',
  /** VFS mount handle prefix for dynamic mount handles (similar to reftag) */
  VFS_MOUNT_PREFIX: 'vfs-mount-',
  /** VFS generator input - receives connection from loader/generated node that created this VFS */
  VFS_GENERATOR_INPUT: 'vfs-generator',
} as const;

// ============================================================================
// Handle Specification
// ============================================================================

/**
 * Handle specification defining connection capabilities
 */
export interface HandleSpec {
  /** Handle unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Data type this handle accepts/provides */
  dataType: DataType;
  /** Connection cardinality */
  cardinality: Cardinality;
  /** Whether this is a dynamic handle (like reftag-*) */
  dynamic?: boolean;
  /** CSS class for handle color */
  colorClass: string;
}

// ============================================================================
// Node Specification
// ============================================================================

/**
 * Node specification defining connection behavior
 */
export interface NodeSpec {
  /** Node type identifier */
  type: string;
  /** Display label */
  label: string;
  /** Input handle specifications */
  inputs: HandleSpec[];
  /** Output handle specifications */
  outputs: HandleSpec[];
  /** Whether users can manually create input connections */
  manualInput: boolean;
  /** Whether users can manually create output connections */
  manualOutput: boolean;
  /** Header background CSS class */
  headerColorClass: string;
  /** Handle color CSS class */
  handleColorClass: string;
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
        colorClass: 'bg-blue-400',
      },
    ],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Output',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-blue-400',
      },
    ],
    manualInput: true,
    manualOutput: true,
    headerColorClass: 'bg-blue-500',
    handleColorClass: 'bg-blue-400!',
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
        colorClass: 'bg-indigo-400',
      },
      {
        id: HandleId.SYSTEM_TAG,
        label: 'System Prompt',
        dataType: DataType.STRING,
        cardinality: Cardinality.OPTIONAL,
        colorClass: 'bg-amber-400',
      },
      {
        id: HandleId.TAG_PREFIX,
        label: 'Tag',
        dataType: DataType.STRING,
        cardinality: Cardinality.OPTIONAL,
        dynamic: true,
        colorClass: 'bg-blue-400',
      },
    ],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Output',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-purple-400',
      },
    ],
    manualInput: true,
    manualOutput: false, // Output auto-connects to GENERATED
    headerColorClass: 'bg-purple-500',
    handleColorClass: 'bg-purple-400!',
  },

  GENERATED: {
    type: 'GENERATED',
    label: 'Generated',
    inputs: [], // Auto-connected
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Output',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-green-400',
      },
      // VFS Output Handle - for file creation/modification scenarios
      {
        id: HandleId.VFS_OUTPUT,
        label: 'Files',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
        colorClass: 'bg-indigo-400',
      },
    ],
    manualInput: false, // Input is automatic
    manualOutput: true,
    headerColorClass: 'bg-green-500',
    handleColorClass: 'bg-green-400!',
  },

  VFS: {
    type: 'VFS',
    label: 'VFS',
    inputs: [
      {
        id: HandleId.VFS_GENERATOR_INPUT,
        label: 'Generator',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
        colorClass: 'bg-green-400',
      },
      {
        id: HandleId.VFS_MOUNT_PREFIX,
        label: 'Mount',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
        dynamic: true,
        colorClass: 'bg-purple-400',
      },
    ],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'VFS Output',
        dataType: DataType.VFS,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-indigo-400',
      },
    ],
    manualInput: true,
    manualOutput: true,
    headerColorClass: 'bg-indigo-500',
    handleColorClass: 'bg-indigo-400!',
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
        colorClass: 'bg-indigo-400',
      },
      {
        id: HandleId.SERVICE_INPUT,
        label: 'Services',
        dataType: DataType.SERVICE,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-purple-400',
      },
    ],
    outputs: [],
    manualInput: true,
    manualOutput: false,
    headerColorClass: 'bg-orange-500',
    handleColorClass: 'bg-orange-400!',
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
        colorClass: 'bg-indigo-400',
      },
      {
        id: HandleId.LOADER_STATE,
        label: 'State',
        dataType: DataType.STATE,
        cardinality: Cardinality.OPTIONAL,
        colorClass: 'bg-teal-400',
      },
      {
        id: HandleId.LOADER_ASSET_VFS,
        label: 'Assets',
        dataType: DataType.VFS,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-indigo-400',
      },
    ],
    outputs: [
      {
        id: HandleId.LOADER_OUTPUT,
        label: 'Service Output',
        dataType: DataType.SERVICE,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-purple-400',
      },
      {
        id: HandleId.LOADER_DOCS_OUTPUT,
        label: 'Docs Output',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
        colorClass: 'bg-indigo-400',
      },
    ],
    manualInput: true,
    manualOutput: true,
    headerColorClass: 'bg-purple-500',
    handleColorClass: 'bg-purple-400!',
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
        colorClass: 'bg-teal-400',
      },
    ],
    manualInput: false,
    manualOutput: true,
    headerColorClass: 'bg-teal-500',
    handleColorClass: 'bg-teal-400!',
  },
};

// ============================================================================
// Registry Accessors
// ============================================================================

/**
 * Get node specification by type
 */
export function getNodeSpec(nodeType: string): NodeSpec | undefined {
  return NodeRegistry[nodeType];
}

/**
 * Get handle specification
 */
export function getHandleSpec(
  nodeType: string,
  handleId: string,
  direction: 'input' | 'output'
): HandleSpec | undefined {
  const nodeSpec = getNodeSpec(nodeType);
  if (!nodeSpec) return undefined;

  const handles = direction === 'input' ? nodeSpec.inputs : nodeSpec.outputs;

  // Exact match
  const exact = handles.find(h => h.id === handleId);
  if (exact) return exact;

  // Dynamic handle match (e.g., reftag-xxx matches reftag- prefix)
  // Find the longest matching prefix to ensure more specific prefixes are matched first
  let bestMatch: HandleSpec | undefined;
  let bestMatchLength = 0;
  
  for (const handle of handles) {
    if (handle.dynamic && handleId.startsWith(handle.id)) {
      if (handle.id.length > bestMatchLength) {
        bestMatch = handle;
        bestMatchLength = handle.id.length;
      }
    }
  }

  return bestMatch;
}

// ============================================================================
// RefTag Helpers
// ============================================================================

/**
 * Check if a handle ID is a reftag handle
 */
export function isRefTagHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(HandleId.REFTAG_PREFIX);
}

/**
 * Extract reftag name from handle ID
 */
export function getRefTagName(handleId: string): string {
  return handleId.slice(HandleId.REFTAG_PREFIX.length);
}

/**
 * Create reftag handle ID from tag name
 */
export function createRefTagHandleId(tagName: string): string {
  return `${HandleId.REFTAG_PREFIX}${tagName}`;
}

// ============================================================================
// Tag Handle Helpers
// ============================================================================

/**
 * Check if a handle ID is a tag handle (for Input node)
 */
export function isTagHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(HandleId.TAG_PREFIX);
}

/**
 * Extract tag name from handle ID (e.g., 'tag-context' -> 'context')
 */
export function getTagName(handleId: string): string {
  return handleId.slice(HandleId.TAG_PREFIX.length);
}

/**
 * Create tag handle ID from tag name
 */
export function createTagHandleId(tagName: string): string {
  return `${HandleId.TAG_PREFIX}${tagName}`;
}

// ============================================================================
// VFS Mount Handle Helpers
// ============================================================================

/**
 * Check if a handle ID is a VFS mount handle
 */
export function isVfsMountHandle(handleId: string | null | undefined): boolean {
  return typeof handleId === 'string' && handleId.startsWith(HandleId.VFS_MOUNT_PREFIX);
}

/**
 * Extract mount ID from handle ID (e.g., 'vfs-mount-abc123' -> 'abc123')
 */
export function getMountIdFromHandle(handleId: string): string {
  return handleId.slice(HandleId.VFS_MOUNT_PREFIX.length);
}

/**
 * Create VFS mount handle ID from mount ID
 */
export function createVfsMountHandleId(mountId: string): string {
  return `${HandleId.VFS_MOUNT_PREFIX}${mountId}`;
}

// ============================================================================
// Connection Validation
// ============================================================================

export interface ConnectionParams {
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Check if data types are compatible
 */
function isDataTypeCompatible(sourceType: DataType, targetType: DataType): boolean {
  return sourceType === targetType;
}

/**
 * Check if a new connection can be added based on cardinality
 */
function canAddConnection(cardinality: Cardinality, currentCount: number): boolean {
  switch (cardinality) {
    case Cardinality.OPTIONAL:
      return currentCount === 0;
    case Cardinality.MANY:
      return true;
    default:
      return false;
  }
}

/**
 * Validate a connection between nodes
 */
export function validateConnection(
  connection: ConnectionParams,
  getNodeType: (nodeId: string) => string | undefined,
  existingEdges: ConnectionParams[],
  getNodeData?: (nodeId: string) => StudioNodeData | undefined
): ValidationResult {
  const sourceType = getNodeType(connection.source);
  const targetType = getNodeType(connection.target);

  if (!sourceType || !targetType) {
    return { valid: false, reason: 'Node not found' };
  }

  const sourceSpec = getNodeSpec(sourceType);
  const targetSpec = getNodeSpec(targetType);

  if (!sourceSpec || !targetSpec) {
    return { valid: false, reason: 'Unknown node type' };
  }

  // Check manual connection permissions
  if (!targetSpec.manualInput) {
    return { valid: false, reason: `${targetType} does not accept manual connections` };
  }

  if (!sourceSpec.manualOutput) {
    return { valid: false, reason: `${sourceType} does not allow manual output connections` };
  }

  const sourceHandleId = connection.sourceHandle ?? HandleId.DEFAULT;
  const targetHandleId = connection.targetHandle ?? HandleId.DEFAULT;

  // Get handle specs
  const sourceHandleSpec = getHandleSpec(sourceType, sourceHandleId, 'output');
  const targetHandleSpec = getHandleSpec(targetType, targetHandleId, 'input');

  if (!sourceHandleSpec) {
    return { valid: false, reason: `Invalid source handle: ${sourceHandleId}` };
  }

  if (!targetHandleSpec) {
    return { valid: false, reason: `Invalid target handle: ${targetHandleId}` };
  }

  // Check data type compatibility
  if (!isDataTypeCompatible(sourceHandleSpec.dataType, targetHandleSpec.dataType)) {
    return {
      valid: false,
      reason: `Type mismatch: ${sourceHandleSpec.dataType} cannot connect to ${targetHandleSpec.dataType}`,
    };
  }

  // Check cardinality
  const existingToHandle = existingEdges.filter(
    e => e.target === connection.target && 
         (e.targetHandle ?? HandleId.DEFAULT) === targetHandleId
  );

  if (!canAddConnection(targetHandleSpec.cardinality, existingToHandle.length)) {
    return {
      valid: false,
      reason: `${targetHandleSpec.label} already has a connection`,
    };
  }

  // Prevent self-connection
  if (connection.source === connection.target) {
    return { valid: false, reason: 'Self-connection not allowed' };
  }

  return { valid: true };
}

/**
 * Create a connection validator function for SvelteFlow
 */
export function createConnectionValidator(
  getNodeType: (nodeId: string) => string | undefined,
  getEdges: () => ConnectionParams[],
  getNodeData?: (nodeId: string) => StudioNodeData | undefined
) {
  return (connection: ConnectionParams): boolean => {
    const result = validateConnection(connection, getNodeType, getEdges(), getNodeData);
    if (!result.valid) {
      console.debug('[ConnectionValidator]', result.reason);
    }
    return result.valid;
  };
}
