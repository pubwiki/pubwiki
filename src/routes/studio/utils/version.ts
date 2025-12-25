/**
 * Version Control Module - Generation Preparation
 * 
 * Handles version preparation for content generation.
 * Core version control functionality has been moved to stores/version/
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { 
  StudioNodeData
} from './types';
import { 
  syncNode,
  type NodeRef
} from '../stores/version';
import { 
  resolvePromptContent, 
  getInputTagConnections,
  getMountpointConnections,
  resolveInputContent,
  getRefTagConnections
} from './reftag';

// Re-export types from new version module for backward compatibility
export type { HistoricalTreeResult } from '../stores/version';

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
  /** Map of mount paths to VFS node IDs */
  mountpoints: Map<string, string>;
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
 */
export async function prepareForGeneration(
  nodes: Node<StudioNodeData>[],
  edges: Edge[],
  inputNodeId: string
): Promise<PrepareGenerationResult> {
  const inputNode = nodes.find(n => n.id === inputNodeId);
  if (!inputNode || inputNode.data.type !== 'INPUT') {
    throw new Error('Invalid input node');
  }

  // Get tag connections for the input node (prompts connected via @tag)
  const tagConnections = getInputTagConnections(inputNodeId, edges);
  const parentPromptIds = Array.from(tagConnections.values());
  
  // Get mountpoint connections (VFS nodes connected via @/path)
  const mountpoints = getMountpointConnections(inputNodeId, edges);
  
  const parentPromptNodes = nodes.filter(
    n => parentPromptIds.includes(n.id) && n.data.type === 'PROMPT'
  );

  // Collect all node IDs that might be involved (direct + indirect via reftags)
  const collectAllInvolvedNodes = (nodeIds: string[], visited: Set<string> = new Set()): string[] => {
    const result: string[] = [];
    for (const nodeId of nodeIds) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      result.push(nodeId);
      
      // Get reftag connections for this node
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.data.type === 'PROMPT') {
        const refTagConnections = getRefTagConnections(nodeId, edges);
        const connectedIds = Array.from(refTagConnections.values());
        result.push(...collectAllInvolvedNodes(connectedIds, visited));
      }
    }
    return result;
  };

  const allInvolvedPromptIds = collectAllInvolvedNodes(parentPromptIds);

  // Sync all involved nodes: save snapshots AND update commits in one step
  let updatedNodes = await Promise.all(nodes.map(async n => {
    // Process input and all involved prompt nodes
    if (n.id !== inputNodeId && !allInvolvedPromptIds.includes(n.id)) {
      return n;
    }

    // Sync the node: saves snapshot and updates commit if content changed
    const synced = await syncNode(n, edges);
    if (synced !== n.data) {
      return { ...n, data: synced };
    }
    
    return n;
  }));

  // Step 2: Capture refs for direct prompts
  const freshInputNode = updatedNodes.find(n => n.id === inputNodeId)!;
  const freshPromptNodes = updatedNodes.filter(
    n => parentPromptIds.includes(n.id) && n.data.type === 'PROMPT'
  );

  const inputRef: NodeRef = { 
    id: inputNodeId, 
    commit: freshInputNode.data.commit 
  };
  
  const promptRefs: NodeRef[] = freshPromptNodes.map(n => ({ 
    id: n.id, 
    commit: n.data.commit 
  }));
  
  const parentRefs: NodeRef[] = [inputRef, ...promptRefs];

  // Step 3: Resolve reftags in prompt nodes and collect indirect refs
  const allPromptRefs: NodeRef[] = [];
  const resolvedPrompts: string[] = [];
  
  for (const promptNode of freshPromptNodes) {
    const resolved = resolvePromptContent(
      promptNode.id, 
      updatedNodes, 
      edges, 
      new Set(), 
      []
    );
    resolvedPrompts.push(resolved.content);
    allPromptRefs.push(...resolved.allPromptRefs);
  }

  // Step 4: Resolve tags in input content
  const inputResolved = resolveInputContent(
    inputNodeId,
    updatedNodes,
    edges,
    new Set(),
    allPromptRefs
  );
  const resolvedUserInput = inputResolved.content;

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

  // Build resolved system prompt
  const resolvedSystemPrompt = resolvedPrompts.filter(Boolean).join('\n\n---\n\n');

  return {
    nodes: updatedNodes,
    inputRef,
    promptRefs,
    indirectPromptRefs: uniqueIndirectRefs,
    parentRefs,
    resolvedSystemPrompt,
    resolvedUserInput,
    mountpoints
  };
}
