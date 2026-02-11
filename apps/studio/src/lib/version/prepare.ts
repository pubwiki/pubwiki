/**
 * Version Control Module - Generation Preparation
 * 
 * Handles version preparation for content generation.
 * Core version control functionality is in the version module.
 * 
 * After content-hash-realtime-update refactoring:
 * - No longer calls syncNode (version is tracked in real-time)
 * - Uses ensureVersionsSynced to ensure all involved nodes are up-to-date
 * - Directly uses node.commit as ref (already up-to-date)
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import type { NodeRef, HistoricalTreeResult } from './types';
import { nodeStore } from '../persistence/node-store.svelte';
import { 
  resolvePromptContent, 
  getInputTagConnections,
  getSystemPromptConnection,
  resolveInputContent,
  getRefTagConnections
} from '../graph/reftag';

// Re-export types for backward compatibility
export type { HistoricalTreeResult };

// ============================================================================
// Types
// ============================================================================

export interface PrepareGenerationResult {
  /** Updated nodes with snapshots created if needed */
  nodes: Node<StudioNodeData>[];
  /** Reference to the input node version being used */
  inputRef: NodeRef;
  /** References to the direct prompt node versions being used */
  promptRefs: NodeRef[];
  /** References to indirect prompt nodes (resolved via reftags) */
  indirectPromptRefs: NodeRef[];
  /** All parent refs for the generated node (input + direct prompts) */
  parentRefs: NodeRef[];
  /** Fully resolved system prompt content (with reftags substituted) */
  resolvedSystemPrompt: string;
  /** Fully resolved user input content (with tags substituted) */
  resolvedUserInput: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Prepare nodes for generation by creating snapshots if content has changed.
 * Returns the refs pointing to the CURRENT content being used for generation.
 * 
 * Key insight: We capture refs AFTER ensuring node commits match current content.
 * This way, the ref always points to the exact content being used.
 * 
 * Also resolves tag references in input content and reftag references in prompts
 * to build the full system prompt and collect indirect prompt refs for version tracking.
 * 
 * After layer separation:
 * - Uses FlowNodeData for flow layer
 * - Uses getNodeData callback for business data
 */
export async function prepareForGeneration(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  inputNodeId: string,
  getNodeData: (nodeId: string) => StudioNodeData | undefined
): Promise<PrepareGenerationResult> {
  const inputData = getNodeData(inputNodeId);
  if (!inputData || inputData.type !== 'INPUT') {
    throw new Error('Invalid input node');
  }

  // Get tag connections for the input node (prompts connected via @tag)
  const tagConnections = getInputTagConnections(inputNodeId, edges);
  const tagPromptIds = Array.from(tagConnections.values());
  
  // Get system prompt connection (prompt connected via SYSTEM_TAG handle)
  const systemPromptNodeId = getSystemPromptConnection(inputNodeId, edges);
  
  // Combine: system prompt node (if any) + tag connected prompts
  const parentPromptIds = systemPromptNodeId 
    ? [systemPromptNodeId, ...tagPromptIds]
    : tagPromptIds;

  // Collect all node IDs that might be involved (direct + indirect via reftags)
  const collectAllInvolvedNodes = (nodeIds: string[], visited: Set<string> = new Set()): string[] => {
    const result: string[] = [];
    for (const nodeId of nodeIds) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      result.push(nodeId);
      
      // Get reftag connections for this node
      const nodeData = getNodeData(nodeId);
      if (nodeData && nodeData.type === 'PROMPT') {
        const refTagConnections = getRefTagConnections(nodeId, edges);
        const connectedIds = Array.from(refTagConnections.values());
        result.push(...collectAllInvolvedNodes(connectedIds, visited));
      }
    }
    return result;
  };

  const allInvolvedPromptIds = collectAllInvolvedNodes(parentPromptIds);
  
  // All involved node IDs (input + all prompts)
  const allInvolvedIds = [inputNodeId, ...allInvolvedPromptIds];

  // Ensure all involved nodes' versions are up-to-date (contentHash/commit)
  await nodeStore.ensureVersionsSynced(allInvolvedIds);

  // Build nodes with fresh data from nodeStore
  const nodesWithData: Node<StudioNodeData>[] = nodes
    .map(n => {
      const data = nodeStore.get(n.id);
      if (!data) return null;
      return { ...n, data } as Node<StudioNodeData>;
    })
    .filter((n): n is Node<StudioNodeData> => n !== null);

  // Capture refs for input and direct prompts (commits are now up-to-date)
  const freshInputData = nodeStore.get(inputNodeId)!;
  const freshPromptNodes = nodesWithData.filter(
    n => parentPromptIds.includes(n.id) && n.data.type === 'PROMPT'
  );

  const inputRef: NodeRef = { 
    id: inputNodeId, 
    commit: freshInputData.commit 
  };
  
  const promptRefs: NodeRef[] = freshPromptNodes.map(n => ({ 
    id: n.id, 
    commit: n.data.commit 
  }));
  
  const parentRefs: NodeRef[] = [inputRef, ...promptRefs];

  // Step 3: Resolve system prompt from SYSTEM_TAG connected prompt (if any)
  // Only the prompt connected to SYSTEM_TAG becomes the system prompt
  let resolvedSystemPrompt = '';
  const allPromptRefs: NodeRef[] = [];
  
  if (systemPromptNodeId) {
    const systemPromptNode = freshPromptNodes.find(n => n.id === systemPromptNodeId);
    if (systemPromptNode) {
      const resolved = resolvePromptContent(
        systemPromptNode.id, 
        nodesWithData, 
        edges, 
        new Set(), 
        []
      );
      resolvedSystemPrompt = resolved.content;
      allPromptRefs.push(...resolved.allPromptRefs);
    }
  }

  // Step 4: Resolve tags in input content (replaces @tagname with connected prompt content)
  const inputResolved = resolveInputContent(
    inputNodeId,
    nodesWithData,
    edges,
    new Set(),
    allPromptRefs
  );
  const resolvedUserInput = inputResolved.content;
  
  // Collect refs from tag-connected prompts (they were resolved in resolveInputContent)
  allPromptRefs.push(...inputResolved.allPromptRefs);

  // Separate direct vs indirect refs
  const directPromptIdSet = new Set(promptRefs.map(r => r.id));
  const indirectPromptRefs = allPromptRefs.filter(
    ref => !directPromptIdSet.has(ref.id)
  );
  
  // Deduplicate indirect refs (keep first occurrence)
  const seenIndirect = new Set<string>();
  const uniqueIndirectRefs = indirectPromptRefs.filter(ref => {
    const key = `${ref.id}:${ref.commit}`;
    if (seenIndirect.has(key)) return false;
    seenIndirect.add(key);
    return true;
  });

  return {
    nodes: nodesWithData,
    inputRef,
    promptRefs,
    indirectPromptRefs: uniqueIndirectRefs,
    parentRefs,
    resolvedSystemPrompt,
    resolvedUserInput
  };
}
