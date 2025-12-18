/**
 * Version Control Module
 * 
 * Handles version tracking, snapshots, and historical version preview for studio nodes.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { 
  StudioNodeData, 
  NodeRef, 
  GeneratedNodeData,
  BaseNodeData,
  SnapshotEdge
} from './types';
import { 
  snapshotStore, 
  generateCommitHash, 
  syncNode
} from './types';
import { 
  resolvePromptContent, 
  getHashtagConnections 
} from './hashtag-utils';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of rebuilding historical dependency tree
 */
export interface HistoricalTreeResult {
  /** 
   * Map of existing node IDs to their historical node data.
   * These nodes exist in the current graph but need to display historical content.
   */
  nodeOverrides: Map<string, StudioNodeData>;
  /** 
   * Phantom nodes for deleted nodes that need to be temporarily displayed.
   * These are full Node objects that can be merged into the nodes array.
   */
  phantomNodes: Node<StudioNodeData>[];
  /** 
   * Historical edges to display.
   * These should replace/augment current edges for the involved nodes.
   */
  historicalEdges: Edge[];
  /**
   * IDs of nodes that are referenced by the generated node (used but not changed).
   * These nodes exist and their content matches the historical version.
   */
  usedNodeIds: Set<string>;
}

export interface PrepareGenerationResult {
  /** Updated nodes with snapshots created if needed */
  nodes: Node<StudioNodeData>[];
  /** Reference to the input node version being used */
  inputRef: NodeRef;
  /** References to the direct prompt node versions being used */
  promptRefs: NodeRef[];
  /** References to indirect prompt nodes (resolved via hashtags) */
  indirectPromptRefs: NodeRef[];
  /** All parent refs for the generated node (input + direct prompts) */
  parentRefs: NodeRef[];
  /** Fully resolved system prompt content (with hashtags substituted) */
  resolvedSystemPrompt: string;
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
 * Also resolves hashtag references to build the full system prompt and collect
 * indirect prompt refs for version tracking.
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

  // Get directly connected prompt nodes
  const parentPromptIds = edges
    .filter(e => e.target === inputNodeId)
    .map(e => e.source);
  
  const parentPromptNodes = nodes.filter(
    n => parentPromptIds.includes(n.id) && n.data.type === 'PROMPT'
  );

  // Collect all node IDs that might be involved (direct + indirect via hashtags)
  const collectAllInvolvedNodes = (nodeIds: string[], visited: Set<string> = new Set()): string[] => {
    const result: string[] = [];
    for (const nodeId of nodeIds) {
      if (visited.has(nodeId)) continue;
      visited.add(nodeId);
      result.push(nodeId);
      
      // Get hashtag connections for this node
      const node = nodes.find(n => n.id === nodeId);
      if (node && node.data.type === 'PROMPT') {
        const hashtagConnections = getHashtagConnections(nodeId, edges);
        const connectedIds = Array.from(hashtagConnections.values());
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

  // Step 3: Resolve hashtags and collect indirect refs
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
    resolvedSystemPrompt
  };
}

/**
 * Rebuild the historical dependency tree for a generated node.
 * 
 * This function:
 * 1. Finds all nodes referenced by the generated node (input, prompts, indirect prompts)
 * 2. For existing nodes with different commits, creates nodeOverrides with historical data
 * 3. For deleted nodes, creates phantom nodes from snapshots
 * 4. Reconstructs historical edges from snapshots
 * 
 * @param generatedNode - The generated node to rebuild history for
 * @param allNodes - All current nodes in the graph
 * @param currentEdges - All current edges in the graph
 * @returns HistoricalTreeResult with overrides, phantoms, and edges
 */
export function rebuildHistoricalTree(
  generatedNode: Node<StudioNodeData>,
  allNodes: Node<StudioNodeData>[],
  currentEdges: Edge[]
): HistoricalTreeResult {
  const nodeOverrides = new Map<string, StudioNodeData>();
  const phantomNodes: Node<StudioNodeData>[] = [];
  const historicalEdges: Edge[] = [];
  const usedNodeIds = new Set<string>();
  
  if (generatedNode.data.type !== 'GENERATED') {
    return { nodeOverrides, phantomNodes, historicalEdges, usedNodeIds };
  }

  const genData = generatedNode.data as GeneratedNodeData;
  
  // Collect all refs we need to process
  const allRefs: NodeRef[] = [
    genData.inputRef,
    ...genData.promptRefs,
    ...(genData.indirectPromptRefs || [])
  ];

  // First pass: identify phantom nodes (deleted nodes)
  const phantomNodeIds = new Set<string>();
  for (const ref of allRefs) {
    const existingNode = allNodes.find(n => n.id === ref.id);
    if (!existingNode) {
      phantomNodeIds.add(ref.id);
    }
  }

  // Second pass: process each ref
  for (const ref of allRefs) {
    const existingNode = allNodes.find(n => n.id === ref.id);
    const snapshot = snapshotStore.get<string>(ref.id, ref.commit);
    
    if (existingNode) {
      // Node exists - mark as used
      usedNodeIds.add(ref.id);
      
      // Check if we need to show historical version
      if (existingNode.data.commit !== ref.commit && snapshot) {
        // Create override with historical data
        const historicalData: StudioNodeData = {
          ...existingNode.data,
          content: snapshot.content,
          commit: snapshot.commit
        };
        nodeOverrides.set(ref.id, historicalData);
      }
      
      // Check incoming edges to restore connections from phantom nodes
      // Use historical snapshot if available, otherwise check current edges
      const edgesToCheck = snapshot?.incomingEdges;
      if (edgesToCheck) {
        for (const snapshotEdge of edgesToCheck) {
          // Only add edge if source is a phantom node (deleted)
          if (phantomNodeIds.has(snapshotEdge.source)) {
            historicalEdges.push({
              id: `historical-${snapshotEdge.source}-${ref.id}-${snapshotEdge.targetHandle || 'default'}`,
              source: snapshotEdge.source,
              target: ref.id,
              sourceHandle: snapshotEdge.sourceHandle,
              targetHandle: snapshotEdge.targetHandle
            });
          }
        }
      }
    } else if (snapshot) {
      // Node was deleted - create phantom node
      // Determine node type from the ref context
      const nodeType = ref.id === genData.inputRef.id ? 'INPUT' : 'PROMPT';
      
      const phantomData: StudioNodeData = {
        id: ref.id,
        type: nodeType,
        content: snapshot.content,
        commit: snapshot.commit,
        snapshotRefs: [],
        parents: [],
        ...(nodeType === 'INPUT' ? { sourcePromptIds: [] } : {})
      } as StudioNodeData;
      
      // Use saved position from snapshot, or calculate fallback position
      const savedPosition = snapshot.position;
      const phantomNode: Node<StudioNodeData> = {
        id: ref.id,
        type: nodeType.toLowerCase(),
        position: savedPosition ?? {
          x: (generatedNode.position?.x ?? 0) - 400,
          y: (generatedNode.position?.y ?? 0) + phantomNodes.length * 150
        },
        data: phantomData
      };
      
      phantomNodes.push(phantomNode);
      
      // Add historical edges from snapshot (only from other phantom nodes)
      if (snapshot.incomingEdges) {
        for (const snapshotEdge of snapshot.incomingEdges) {
          // Only add edge if source is also a phantom node
          if (phantomNodeIds.has(snapshotEdge.source)) {
            historicalEdges.push({
              id: `historical-${snapshotEdge.source}-${ref.id}-${snapshotEdge.targetHandle || 'default'}`,
              source: snapshotEdge.source,
              target: ref.id,
              sourceHandle: snapshotEdge.sourceHandle,
              targetHandle: snapshotEdge.targetHandle
            });
          }
        }
      }
    }
  }

  return { nodeOverrides, phantomNodes, historicalEdges, usedNodeIds };
}

/**
 * Check if an edge connects to a generated node using an old version reference.
 */
export function isOldVersionEdge(
  edge: Edge,
  nodes: Node<StudioNodeData>[]
): boolean {
  const targetNode = nodes.find(n => n.id === edge.target);
  if (targetNode?.data.type !== 'GENERATED') {
    return false;
  }

  const genData = targetNode.data as GeneratedNodeData;
  const sourceNode = nodes.find(n => n.id === edge.source);
  
  if (!sourceNode) {
    return false;
  }

  // Check input ref
  if (genData.inputRef.id === edge.source && 
      sourceNode.data.commit !== genData.inputRef.commit) {
    return true;
  }

  // Check prompt refs
  const promptRef = genData.promptRefs.find(ref => ref.id === edge.source);
  if (promptRef && sourceNode.data.commit !== promptRef.commit) {
    return true;
  }

  return false;
}

/**
 * Apply styling to edges based on version references.
 * Old version references get dashed styling.
 */
export function styleEdgesForVersions(
  edges: Edge[],
  nodes: Node<StudioNodeData>[]
): { edges: Edge[]; changed: boolean } {
  let changed = false;
  const OLD_VERSION_STYLE = 'stroke-dasharray: 5 5; stroke: #9ca3af;';

  const styledEdges = edges.map(edge => {
    const shouldBeDashed = isOldVersionEdge(edge, nodes);
    
    if (shouldBeDashed) {
      if (edge.style !== OLD_VERSION_STYLE) {
        changed = true;
        return { ...edge, style: OLD_VERSION_STYLE, animated: false };
      }
    } else if (edge.style) {
      changed = true;
      const { style, animated, ...rest } = edge;
      return rest;
    }
    
    return edge;
  });

  return { edges: styledEdges, changed };
}
