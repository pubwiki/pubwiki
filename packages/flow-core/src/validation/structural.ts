/**
 * Structural Validation
 * 
 * Validates basic graph structure:
 * - All edge endpoints reference existing nodes
 * - No duplicate edges
 */

import type { ImmutableGraph } from '../graph';
import type { GraphValidationResult } from './types';

/**
 * Validate basic graph structure
 * 
 * Checks:
 * - All edge endpoints reference existing nodes
 * - No duplicate edges
 * 
 * @param graph - Graph to validate
 * @returns Validation result
 */
export function validateStructure(graph: ImmutableGraph): GraphValidationResult {
  // Check for duplicate edges
  const seenEdges = new Set<string>();
  for (const edge of graph.edges) {
    const key = `${edge.source}:${edge.target}`;
    if (seenEdges.has(key)) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Duplicate edge detected: ${edge.source} -> ${edge.target}`,
        },
      };
    }
    seenEdges.add(key);
  }

  // Check edge endpoints exist
  for (const edge of graph.edges) {
    if (!graph.getNode(edge.source)) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Edge source node ${edge.source} does not exist in the graph`,
        },
      };
    }
    if (!graph.getNode(edge.target)) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Edge target node ${edge.target} does not exist in the graph`,
        },
      };
    }
  }

  return { success: true, data: undefined };
}
