/**
 * SAVE Node Validation
 * 
 * Validates SAVE nodes:
 * - Each SAVE references a STATE node present in graph
 * - STATE → LOADER → SANDBOX connectivity
 */

import type { ImmutableGraph } from '../graph';
import type { GraphValidationResult } from './types';

/**
 * SAVE node content shape (for type assertion)
 */
interface SaveNodeContent {
  type: 'SAVE';
  stateNodeId: string;
}

/**
 * Validate SAVE nodes in the graph
 * 
 * Checks:
 * - Each SAVE references a STATE node present in graph
 * - STATE → LOADER → SANDBOX connectivity
 * 
 * @param graph - Graph to validate
 * @returns Validation result
 */
export function validateSaveNodes(graph: ImmutableGraph): GraphValidationResult {
  const saveNodes = graph.getNodesByType('SAVE');

  if (saveNodes.length === 0) {
    return { success: true, data: undefined };
  }

  // Build state node map: stateNodeId -> commit
  const stateNodeIds = new Set<string>();
  for (const node of graph.getNodesByType('STATE')) {
    stateNodeIds.add(node.nodeId);
  }

  // Cache for graph connectivity validation results
  const connectivityCache = new Map<string, boolean>();

  for (const saveNode of saveNodes) {
    // SAVE node content must have stateNodeId
    const saveContent = saveNode.content as SaveNodeContent;

    if (!saveContent?.stateNodeId) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `SAVE node ${saveNode.nodeId} missing stateNodeId in content`,
        },
      };
    }

    const stateNodeId = saveContent.stateNodeId;

    // STATE node must be present in the same artifact version's nodes
    if (!stateNodeIds.has(stateNodeId)) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `SAVE node ${saveNode.nodeId} references state node ${stateNodeId} which is not present in this artifact version`,
        },
      };
    }

    // Validate graph connectivity: STATE → LOADER → SANDBOX (with caching)
    let hasValidPath = connectivityCache.get(stateNodeId);
    if (hasValidPath === undefined) {
      hasValidPath = graph.hasPathThrough(stateNodeId, 'SANDBOX', ['LOADER']);
      connectivityCache.set(stateNodeId, hasValidPath);
    }
    if (!hasValidPath) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Save validation failed: state node ${stateNodeId} is not connected to a SANDBOX node through a LOADER node`,
        },
      };
    }
  }

  return { success: true, data: undefined };
}
