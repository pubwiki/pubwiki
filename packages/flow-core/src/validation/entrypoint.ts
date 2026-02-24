/**
 * Entrypoint Validation
 * 
 * Validates entrypoint configuration:
 * - sandboxNodeId exists and is SANDBOX type
 * - saveCommit exists as a SAVE node
 * - Referenced STATE is in the graph
 */

import type { ImmutableGraph } from '../graph';
import type { GraphValidationResult, EntrypointConfig } from './types';

/**
 * SAVE node content shape (for type assertion)
 */
interface SaveNodeContent {
  type: 'SAVE';
  stateNodeId: string;
}

/**
 * Validate entrypoint configuration
 * 
 * Checks:
 * - sandboxNodeId exists and is SANDBOX type
 * - saveCommit exists as a SAVE node
 * - Referenced STATE is in the graph
 * 
 * @param graph - Graph to validate
 * @param entrypoint - Entrypoint configuration (optional)
 * @returns Validation result
 */
export function validateEntrypoint(
  graph: ImmutableGraph,
  entrypoint?: EntrypointConfig,
): GraphValidationResult {
  if (!entrypoint) {
    return { success: true, data: undefined };
  }

  const { saveCommit, sandboxNodeId } = entrypoint;

  // Verify sandboxNodeId exists and is SANDBOX type
  const sandboxNode = graph.getNode(sandboxNodeId);
  if (!sandboxNode) {
    return {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not in the graph`,
      },
    };
  }
  if (sandboxNode.type !== 'SANDBOX') {
    return {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: `Entrypoint sandboxNodeId ${sandboxNodeId} is not a SANDBOX node (got ${sandboxNode.type})`,
      },
    };
  }

  // Verify saveCommit is in the SAVE nodes
  const saveNode = graph.getNodesByType('SAVE').find(n => n.commit === saveCommit);
  if (!saveNode) {
    return {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: `Entrypoint saveCommit ${saveCommit} is not found in the SAVE nodes`,
      },
    };
  }

  // Verify the save references a STATE node in this artifact
  const saveContent = saveNode.content as SaveNodeContent;
  const stateNodeIds = new Set(graph.getNodesByType('STATE').map(n => n.nodeId));
  if (!stateNodeIds.has(saveContent.stateNodeId)) {
    return {
      success: false,
      error: {
        code: 'BAD_REQUEST',
        message: `Entrypoint save references state node ${saveContent.stateNodeId} which is not in the graph`,
      },
    };
  }

  return { success: true, data: undefined };
}
