/**
 * Connection Type System
 * 
 * Defines the type system for node connections in Studio.
 * Provides type-safe handle definitions and connection validation.
 */

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
  /** Service input on Sandbox node */
  SERVICE_INPUT: 'service-input',
  /** Prompt input on Input node */
  PROMPT_INPUT: 'prompt-input',
  /** RefTag handle prefix for dynamic handles */
  REFTAG_PREFIX: 'reftag-',
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
        id: HandleId.PROMPT_INPUT,
        label: 'Prompts',
        dataType: DataType.STRING,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-blue-400',
      },
      {
        id: HandleId.VFS_INPUT,
        label: 'VFS',
        dataType: DataType.VFS,
        cardinality: Cardinality.OPTIONAL,
        colorClass: 'bg-indigo-400',
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
    ],
    manualInput: false, // Input is automatic
    manualOutput: true,
    headerColorClass: 'bg-green-500',
    handleColorClass: 'bg-green-400!',
  },

  VFS: {
    type: 'VFS',
    label: 'VFS',
    inputs: [],
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'VFS Output',
        dataType: DataType.VFS,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-indigo-400',
      },
    ],
    manualInput: false,
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
    inputs: [], // Future: internal logic decides
    outputs: [
      {
        id: HandleId.DEFAULT,
        label: 'Service Output',
        dataType: DataType.SERVICE,
        cardinality: Cardinality.MANY,
        colorClass: 'bg-purple-400',
      },
    ],
    manualInput: false,
    manualOutput: true,
    headerColorClass: 'bg-purple-500',
    handleColorClass: 'bg-purple-400!',
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
  for (const handle of handles) {
    if (handle.dynamic && handleId.startsWith(handle.id)) {
      return handle;
    }
  }

  return undefined;
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
  existingEdges: ConnectionParams[]
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
  getEdges: () => ConnectionParams[]
) {
  return (connection: ConnectionParams): boolean => {
    const result = validateConnection(connection, getNodeType, getEdges());
    if (!result.valid) {
      console.debug('[ConnectionValidator]', result.reason);
    }
    return result.valid;
  };
}
