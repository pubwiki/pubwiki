/**
 * Hashtag Utilities
 * 
 * Provides utilities for parsing and resolving hashtag references in prompt content.
 * Hashtags follow the format #name and create named input slots for prompt composition.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, NodeRef, PromptNodeData, SnapshotEdge } from './types';
import { snapshotStore } from './types';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a parsed hashtag in content
 */
export interface ParsedHashtag {
  /** The hashtag name (without #) */
  name: string;
  /** Start position in the content */
  start: number;
  /** End position in the content */
  end: number;
}

/**
 * Represents a hashtag slot (connection point)
 */
export interface HashtagSlot {
  /** The hashtag name */
  name: string;
  /** ID of the connected node (if any) */
  connectedNodeId: string | null;
}

/**
 * Result of resolving prompt content with hashtag substitutions
 */
export interface ResolvedPrompt {
  /** The fully resolved content with hashtags replaced */
  content: string;
  /** All prompt refs used (including indirect ones from nested hashtags) */
  allPromptRefs: NodeRef[];
}

// ============================================================================
// Hashtag Parsing
// ============================================================================

/**
 * Regex pattern for hashtags: # followed by word characters (letters, digits, underscore)
 */
const HASHTAG_PATTERN = /#([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Parse hashtags from content string
 */
export function parseHashtags(content: string): ParsedHashtag[] {
  const hashtags: ParsedHashtag[] = [];
  let match: RegExpExecArray | null;
  
  // Reset regex lastIndex
  HASHTAG_PATTERN.lastIndex = 0;
  
  while ((match = HASHTAG_PATTERN.exec(content)) !== null) {
    hashtags.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return hashtags;
}

/**
 * Get unique hashtag names from content
 */
export function getUniqueHashtagNames(content: string): string[] {
  const hashtags = parseHashtags(content);
  const uniqueNames = new Set(hashtags.map(h => h.name));
  return Array.from(uniqueNames);
}

// ============================================================================
// Hashtag Edge Utilities
// ============================================================================

/**
 * Check if an edge is a hashtag edge by checking its targetHandle
 */
export function isHashtagEdge(edge: Edge): boolean {
  return typeof edge.targetHandle === 'string' && edge.targetHandle.startsWith('hashtag-');
}

/**
 * Extract hashtag name from edge's targetHandle
 */
export function getHashtagNameFromEdge(edge: Edge): string | null {
  if (!isHashtagEdge(edge)) return null;
  return edge.targetHandle!.slice('hashtag-'.length);
}

/**
 * Get hashtag connections for a node
 * Returns a map of hashtag name -> connected source node ID
 */
export function getHashtagConnections(
  nodeId: string,
  edges: Edge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (edge.target === nodeId && isHashtagEdge(edge)) {
      const hashtagName = getHashtagNameFromEdge(edge);
      if (hashtagName) {
        connections.set(hashtagName, edge.source);
      }
    }
  }
  
  return connections;
}

/**
 * Get hashtag connections from snapshot edges (used for historical preview)
 * Returns a map of hashtag name -> connected source node ID
 */
export function getHashtagConnectionsFromSnapshotEdges(
  edges: SnapshotEdge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (typeof edge.targetHandle === 'string' && edge.targetHandle.startsWith('hashtag-')) {
      const hashtagName = edge.targetHandle.slice('hashtag-'.length);
      connections.set(hashtagName, edge.source);
    }
  }
  
  return connections;
}

/**
 * Get hashtag slots for a prompt node
 */
export function getHashtagSlots(
  nodeData: PromptNodeData,
  edges: Edge[]
): HashtagSlot[] {
  const hashtagNames = getUniqueHashtagNames(nodeData.content);
  const connections = getHashtagConnections(nodeData.id, edges);
  
  return hashtagNames.map(name => ({
    name,
    connectedNodeId: connections.get(name) ?? null
  }));
}

// ============================================================================
// Content Resolution
// ============================================================================

/**
 * Resolve prompt content by substituting hashtags with connected prompt content.
 * Recursively resolves nested hashtags.
 * 
 * @param nodeId - The prompt node ID to resolve
 * @param nodes - All nodes in the graph
 * @param edges - All edges in the graph
 * @param visited - Set of already visited node IDs (to prevent infinite loops)
 * @param promptRefs - Accumulator for all prompt refs used (for version tracking)
 */
export function resolvePromptContent(
  nodeId: string,
  nodes: Node<StudioNodeData>[],
  edges: Edge[],
  visited: Set<string> = new Set(),
  promptRefs: NodeRef[] = []
): ResolvedPrompt {
  // Prevent infinite loops
  if (visited.has(nodeId)) {
    return { content: `[Circular reference: #${nodeId}]`, allPromptRefs: promptRefs };
  }
  visited.add(nodeId);
  
  const node = nodes.find(n => n.id === nodeId);
  if (!node || node.data.type !== 'PROMPT') {
    return { content: '', allPromptRefs: promptRefs };
  }
  
  const promptData = node.data;
  let content = promptData.content;
  
  // Add this node's ref
  promptRefs.push({ id: nodeId, commit: promptData.commit });
  
  // Get hashtag connections
  const connections = getHashtagConnections(nodeId, edges);
  
  // No connections - return content as-is
  if (connections.size === 0) {
    return { content, allPromptRefs: promptRefs };
  }
  
  // Parse hashtags and replace from end to start to preserve positions
  const hashtags = parseHashtags(content);
  
  // Sort by position descending (replace from end first)
  hashtags.sort((a, b) => b.start - a.start);
  
  for (const hashtag of hashtags) {
    const connectedNodeId = connections.get(hashtag.name);
    
    if (connectedNodeId) {
      // Recursively resolve the connected prompt
      const resolved = resolvePromptContent(connectedNodeId, nodes, edges, visited, promptRefs);
      // Replace the hashtag with resolved content
      content = content.slice(0, hashtag.start) + resolved.content + content.slice(hashtag.end);
    }
    // If not connected, leave the hashtag as-is
  }
  
  return { content, allPromptRefs: promptRefs };
}

/**
 * Resolve prompt content using historical versions from refs.
 * Used for regeneration to reproduce exact historical context.
 */
export function resolvePromptContentFromRefs(
  nodeId: string,
  nodeCommit: string,
  nodes: Node<StudioNodeData>[],
  edges: Edge[],
  allRefs: NodeRef[],
  visited: Set<string> = new Set()
): string {
  if (visited.has(nodeId)) {
    return `[Circular reference]`;
  }
  visited.add(nodeId);
  
  // Find the content for this ref
  let content: string;
  const node = nodes.find(n => n.id === nodeId);
  
  if (node && node.data.commit === nodeCommit) {
    // Current version matches
    content = node.data.content as string;
  } else {
    // Get from snapshot store
    const snapshot = snapshotStore.get<string>(nodeId, nodeCommit);
    if (!snapshot) {
      return `[Missing snapshot: ${nodeId}:${nodeCommit.slice(0, 7)}]`;
    }
    content = snapshot.content;
  }
  
  // Get hashtag connections (using current edges since we don't store edge history)
  const connections = getHashtagConnections(nodeId, edges);
  
  if (connections.size === 0) {
    return content;
  }
  
  // Parse and replace hashtags
  const hashtags = parseHashtags(content);
  hashtags.sort((a, b) => b.start - a.start);
  
  for (const hashtag of hashtags) {
    const connectedNodeId = connections.get(hashtag.name);
    
    if (connectedNodeId) {
      // Find the ref for this connected node
      const ref = allRefs.find(r => r.id === connectedNodeId);
      if (ref) {
        const resolvedContent = resolvePromptContentFromRefs(
          connectedNodeId,
          ref.commit,
          nodes,
          edges,
          allRefs,
          visited
        );
        content = content.slice(0, hashtag.start) + resolvedContent + content.slice(hashtag.end);
      }
    }
  }
  
  return content;
}
