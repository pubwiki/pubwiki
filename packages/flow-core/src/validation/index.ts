/**
 * Validation Module
 * 
 * Pure validation functions for artifact graphs.
 * These functions have no side effects and can be used
 * on both frontend (pre-validation) and backend.
 */

// Graph-level validation types
export type { GraphValidationResult, GraphValidationError, GraphValidationErrorCode, EntrypointConfig } from './types';

// Graph-level validation functions
export { validateStructure } from './structural';
export { validateSaveNodes } from './save-nodes';
export { validateEntrypoint } from './entrypoint';

// Connection-level validation (re-exported from registry)
export { validateConnection, type ConnectionParams, type ValidationResult } from '../registry/connection';

import type { ImmutableGraph } from '../graph';
import type { GraphValidationResult, EntrypointConfig } from './types';
import { validateStructure } from './structural';
import { validateSaveNodes } from './save-nodes';
import { validateEntrypoint } from './entrypoint';

/**
 * Validate basic connection rules in the graph
 * 
 * This is a lightweight validation that only checks:
 * - No self-connections (a node connecting to itself)
 * 
 * Note: This does NOT use the full validateConnection() from registry,
 * which is designed for UI manual connection validation and includes
 * stricter rules like manualInput/manualOutput permissions.
 * 
 * @param graph - Graph to validate
 * @returns Validation result
 */
function validateConnections(graph: ImmutableGraph): GraphValidationResult {
  for (const edge of graph.edges) {
    // Check for self-connection
    if (edge.source === edge.target) {
      return {
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: `Self-connection not allowed: node ${edge.source} connects to itself`,
        },
      };
    }
  }
  
  return { success: true, data: undefined };
}

/**
 * Options for graph validation beyond structural checks
 */
export interface ValidateGraphOptions {
  /** Entrypoint configuration (optional) */
  entrypoint?: EntrypointConfig;
  /** Build cache key — required when entrypoint is present */
  buildCacheKey?: string;
}

/**
 * Validate an artifact graph
 * 
 * Runs all validations in order:
 * 1. Structural validation (edges reference existing nodes, no duplicates)
 * 2. Connection validation (handle compatibility, cardinality)
 * 3. SAVE node validation (STATE references, connectivity)
 * 4. Entrypoint validation (if provided)
 * 5. Build cache requirement (entrypoint requires buildCacheKey)
 * 
 * @param graph - Graph to validate
 * @param options - Optional validation options (entrypoint, buildCacheKey)
 * @returns Validation result
 */
export function validateGraph(
  graph: ImmutableGraph,
  options?: ValidateGraphOptions,
): GraphValidationResult {
  // Validate basic structure first
  const structureResult = validateStructure(graph);
  if (!structureResult.success) return structureResult;

  // Validate all connections
  const connectionResult = validateConnections(graph);
  if (!connectionResult.success) return connectionResult;

  // Validate SAVE nodes
  const saveResult = validateSaveNodes(graph);
  if (!saveResult.success) return saveResult;

  // Validate entrypoint
  const entrypointResult = validateEntrypoint(graph, options?.entrypoint);
  if (!entrypointResult.success) return entrypointResult;

  // Entrypoint requires build cache
  if (options?.entrypoint && !options.buildCacheKey) {
    return {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: 'buildCacheKey is required when entrypoint is specified. Please build the entrypoint before publishing.',
      },
    };
  }

  return { success: true, data: undefined };
}
