/**
 * Node Name Validation Utilities
 * 
 * Provides validation functions for node names across all node types:
 * - Names must be unique within the project
 * - Names cannot be empty
 * - Any Unicode characters are allowed
 */

import { nodeStore } from '$lib/persistence';

// ============================================================================
// Node Type Display Names (for generating default names)
// ============================================================================

const NODE_TYPE_NAMES: Record<string, string> = {
  INPUT: 'Input',
  PROMPT: 'Prompt',
  GENERATED: 'Generated',
  VFS: 'Files',
  SANDBOX: 'Preview',
  LOADER: 'Service',
  STATE: 'State',
};

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a node name format
 * 
 * Rules:
 * - Cannot be empty
 * - Cannot be only whitespace
 * 
 * @param name - The name to validate
 * @returns Error message if invalid, null if valid
 */
export function validateNodeNameFormat(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Name cannot be empty';
  }
  
  return null;
}

/**
 * Check if a node name is unique
 * 
 * @param name - The name to check
 * @param excludeNodeId - Optional node ID to exclude (for editing existing nodes)
 * @returns true if unique, false if a duplicate exists
 */
export function isNodeNameUnique(
  name: string,
  excludeNodeId?: string
): boolean {
  return !nodeStore.isNameTaken(name.trim(), excludeNodeId);
}

/**
 * Validate a node name (format and uniqueness)
 * 
 * @param name - The name to validate
 * @param excludeNodeId - Optional node ID to exclude (for editing existing nodes)
 * @returns Error message if invalid, null if valid
 */
export function validateNodeName(
  name: string,
  excludeNodeId?: string
): string | null {
  // Check format first
  const formatError = validateNodeNameFormat(name);
  if (formatError) {
    return formatError;
  }
  
  // Check uniqueness
  if (!isNodeNameUnique(name, excludeNodeId)) {
    return 'A node with this name already exists';
  }
  
  return null;
}

/**
 * Generate a unique default name for a node type
 * 
 * Generates names like "Prompt 1", "Prompt 2", "Input 1", etc.
 * 
 * @param nodeType - The node type (e.g., 'PROMPT', 'INPUT', 'VFS')
 * @returns A unique name for the node
 */
export function generateUniqueNodeName(nodeType: string): string {
  const baseName = NODE_TYPE_NAMES[nodeType] || nodeType;
  
  // Try without number first
  if (!nodeStore.isNameTaken(baseName)) {
    return baseName;
  }
  
  // Find the next available number
  let counter = 2;
  while (nodeStore.isNameTaken(`${baseName} ${counter}`)) {
    counter++;
  }
  
  return `${baseName} ${counter}`;
}

/**
 * Ensure a name is unique by appending a number if necessary
 * 
 * @param baseName - The desired base name
 * @param excludeNodeId - Optional node ID to exclude
 * @returns The name (possibly with a number suffix) that is guaranteed unique
 */
export function ensureUniqueName(baseName: string, excludeNodeId?: string): string {
  const trimmed = baseName.trim();
  
  if (!nodeStore.isNameTaken(trimmed, excludeNodeId)) {
    return trimmed;
  }
  
  // Find the next available number
  let counter = 2;
  while (nodeStore.isNameTaken(`${trimmed} (${counter})`, excludeNodeId)) {
    counter++;
  }
  
  return `${trimmed} (${counter})`;
}
