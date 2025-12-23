/**
 * reftag Utilities
 * 
 * Provides utilities for parsing and resolving reftag references in prompt content.
 * reftags follow the format @name and create named input slots for prompt composition.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, NodeRef, PromptNodeData, SnapshotEdge } from './types';
import { snapshotStore } from './types';
import { isRefTagHandle, getRefTagName } from './connection';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a parsed reftag in content
 */
export interface ParsedRefTag {
  /** The reftag name (without @) */
  name: string;
  /** Start position in the content */
  start: number;
  /** End position in the content */
  end: number;
}

/**
 * Result of resolving prompt content with reftag substitutions
 */
export interface ResolvedPrompt {
  /** The fully resolved content with reftags replaced */
  content: string;
  /** All prompt refs used (including indirect ones from nested reftags) */
  allPromptRefs: NodeRef[];
}

// ============================================================================
// reftag Parsing
// ============================================================================

/**
 * Regex pattern for reftags: @ followed by word characters (letters, digits, underscore)
 */
export const REFTAG_PATTERN = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Parse reftags from content string
 */
export function parseRefTags(content: string): ParsedRefTag[] {
  const reftags: ParsedRefTag[] = [];
  let match: RegExpExecArray | null;
  
  // Reset regex lastIndex
  REFTAG_PATTERN.lastIndex = 0;
  
  while ((match = REFTAG_PATTERN.exec(content)) !== null) {
    reftags.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return reftags;
}

/**
 * Get unique reftag names from content
 */
export function getUniqueRefTagNames(content: string): string[] {
  const reftags = parseRefTags(content);
  const uniqueNames = new Set(reftags.map(h => h.name));
  return Array.from(uniqueNames);
}

// ============================================================================
// reftag Edge Utilities
// ============================================================================

/**
 * Check if an edge is a reftag edge by checking its targetHandle
 */
export function isRefTagEdge(edge: Edge | SnapshotEdge): boolean {
  return isRefTagHandle(edge.targetHandle);
}

/**
 * Extract reftag name from edge's targetHandle
 */
export function getRefTagNameFromEdge(edge: Edge | SnapshotEdge): string | null {
  if (!isRefTagEdge(edge)) return null;
  return getRefTagName(edge.targetHandle!);
}

/**
 * Get reftag connections for a node
 * Returns a map of reftag name -> connected source node ID
 */
export function getRefTagConnections(
  nodeId: string,
  edges: Edge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (edge.target === nodeId && isRefTagEdge(edge)) {
      const refTagName = getRefTagNameFromEdge(edge);
      if (refTagName) {
        connections.set(refTagName, edge.source);
      }
    }
  }
  
  return connections;
}

/**
 * Get reftag connections from snapshot edges (used for historical preview)
 * Returns a map of reftag name -> connected source node ID
 */
export function getRefTagConnectionsFromSnapshotEdges(
  edges: SnapshotEdge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (isRefTagHandle(edge.targetHandle)) {
      const refTagName = getRefTagName(edge.targetHandle!);
      connections.set(refTagName, edge.source);
    }
  }
  
  return connections;
}

// ============================================================================
// Content Resolution
// ============================================================================

/**
 * Resolve prompt content by substituting reftags with connected prompt content.
 * Recursively resolves nested reftags.
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
  
  // Get reftag connections
  const connections = getRefTagConnections(nodeId, edges);
  
  // No connections - return content as-is
  if (connections.size === 0) {
    return { content, allPromptRefs: promptRefs };
  }
  
  // Parse reftags and replace from end to start to preserve positions
  const reftags = parseRefTags(content);
  
  // Sort by position descending (replace from end first)
  reftags.sort((a, b) => b.start - a.start);
  
  for (const reftag of reftags) {
    const connectedNodeId = connections.get(reftag.name);
    
    if (connectedNodeId) {
      // Recursively resolve the connected prompt
      const resolved = resolvePromptContent(connectedNodeId, nodes, edges, visited, promptRefs);
      // Replace the reftag with resolved content
      content = content.slice(0, reftag.start) + resolved.content + content.slice(reftag.end);
    }
    // If not connected, leave the reftag as-is
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
  
  // Get reftag connections (using current edges since we don't store edge history)
  const connections = getRefTagConnections(nodeId, edges);
  
  if (connections.size === 0) {
    return content;
  }
  
  // Parse and replace reftags
  const reftags = parseRefTags(content);
  reftags.sort((a, b) => b.start - a.start);
  
  for (const reftag of reftags) {
    const connectedNodeId = connections.get(reftag.name);
    
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
        content = content.slice(0, reftag.start) + resolvedContent + content.slice(reftag.end);
      }
    }
  }
  
  return content;
}
