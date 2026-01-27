/**
 * ID Remapping Utilities for Import Operations
 * 
 * Shared utilities for generating new node IDs and remapping references
 * when importing projects. Used by both cloud import (import.ts) and
 * local import (import-local.ts).
 */

import { GeneratedContent } from '../types/content';

// ============================================================================
// Types
// ============================================================================

/**
 * ID mapping from old node IDs to new node IDs
 */
export type IdMap = Map<string, string>;

/**
 * Minimal node info needed for ID mapping
 */
export interface NodeWithId {
  id: string;
}

// ============================================================================
// ID Mapping Functions
// ============================================================================

/**
 * Generate new IDs for all nodes and create a mapping.
 * Creates a Map from old node IDs to new UUIDs.
 * 
 * @param nodes - Array of nodes with id property
 * @returns Map from old ID to new UUID
 */
export function createIdMapping<T extends NodeWithId>(nodes: T[]): IdMap {
  const idMap = new Map<string, string>();
  for (const node of nodes) {
    idMap.set(node.id, crypto.randomUUID());
  }
  return idMap;
}

/**
 * Remap a node reference using the ID map.
 * Falls back to original ID if not found in map.
 * 
 * @param ref - Node reference with id and commit
 * @param idMap - ID mapping
 * @returns Remapped node reference
 */
export function remapNodeRef(
  ref: { id: string; commit: string }, 
  idMap: IdMap
): { id: string; commit: string } {
  return {
    id: idMap.get(ref.id) ?? ref.id,
    commit: ref.commit
  };
}

/**
 * Remap node ID references in GeneratedContent.
 * Creates a new GeneratedContent instance with all node references remapped.
 * 
 * @param content - Original GeneratedContent
 * @param idMap - ID mapping from old to new IDs
 * @returns New GeneratedContent with remapped references
 */
export function remapGeneratedContent(content: GeneratedContent, idMap: IdMap): GeneratedContent {
  return new GeneratedContent(
    structuredClone(content.blocks),
    remapNodeRef(content.inputRef, idMap),
    content.promptRefs.map(ref => remapNodeRef(ref, idMap)),
    content.indirectPromptRefs.map(ref => remapNodeRef(ref, idMap)),
    content.inputVfsRef ? {
      nodeId: idMap.get(content.inputVfsRef.nodeId) ?? content.inputVfsRef.nodeId,
      commit: content.inputVfsRef.commit
    } : null,
    content.outputVfsId ? (idMap.get(content.outputVfsId) ?? content.outputVfsId) : null
  );
}
