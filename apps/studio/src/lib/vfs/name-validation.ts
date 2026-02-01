/**
 * VFS Name Validation Utilities
 * 
 * Provides validation functions for VFS node names:
 * - Names must be unique within the project
 * - Names cannot contain slashes (/)
 * - Names must be non-empty
 * - Any other Unicode characters are allowed
 */

import { nodeStore } from '$lib/persistence';
import type { VFSContent } from '$lib/types';

/**
 * Validate a VFS name format
 * 
 * Rules:
 * - Cannot be empty
 * - Cannot contain slashes (/)
 * - Any other Unicode characters are allowed
 * 
 * @param name - The name to validate
 * @returns Error message if invalid, null if valid
 */
export function validateVfsNameFormat(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Name cannot be empty';
  }
  
  if (name.includes('/')) {
    return 'Name cannot contain slashes (/)';
  }
  
  return null;
}

/**
 * Check if a VFS name is valid (format check only)
 * 
 * @param name - The name to check
 * @returns true if valid, false otherwise
 */
export function isValidVfsName(name: string): boolean {
  return validateVfsNameFormat(name) === null;
}

/**
 * Check if a VFS name is unique within the project
 * 
 * @param name - The name to check
 * @param projectId - The project ID to check within
 * @param excludeNodeId - Optional node ID to exclude (for editing existing nodes)
 * @returns true if unique, false if a duplicate exists
 */
export function isVfsNameUnique(
  name: string,
  projectId: string,
  excludeNodeId?: string
): boolean {
  const trimmedName = name.trim();
  
  // Get all nodes and check for duplicates
  for (const data of nodeStore.getAll()) {
    // Skip the node being edited
    if (data.id === excludeNodeId) continue;
    
    // Only check VFS nodes
    if (data.type !== 'VFS') continue;
    
    // Only check nodes in the same project
    const content = data.content as VFSContent;
    if (content.projectId !== projectId) continue;
    
    // Check for name collision using node name
    if (data.name === trimmedName) {
      return false;
    }
  }
  
  return true;
}

/**
 * Validate a VFS name (format and uniqueness)
 * 
 * @param name - The name to validate
 * @param projectId - The project ID to check uniqueness within
 * @param excludeNodeId - Optional node ID to exclude (for editing existing nodes)
 * @returns Error message if invalid, null if valid
 */
export function validateVfsName(
  name: string,
  projectId: string,
  excludeNodeId?: string
): string | null {
  // Check format first
  const formatError = validateVfsNameFormat(name);
  if (formatError) {
    return formatError;
  }
  
  // Check uniqueness
  if (!isVfsNameUnique(name, projectId, excludeNodeId)) {
    return 'A VFS with this name already exists';
  }
  
  return null;
}
