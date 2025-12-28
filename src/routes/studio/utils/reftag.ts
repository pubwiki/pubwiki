/**
 * reftag Utilities
 * 
 * Provides utilities for parsing and resolving reftag references in prompt content.
 * reftag format: @name - Creates a named input slot for prompt composition (e.g., @system, @context)
 * 
 * Note: Mountpoints for VFS are no longer parsed from text. They are managed via
 * InputNodeData.content.mountpoints array and created through UI interactions.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, PromptNodeData, InputNodeData } from './types';
import type { PromptContent, InputContent } from './content-types';
import { snapshotStore, type NodeRef, type SnapshotEdge } from '../stores/version';
import { isRefTagHandle, getRefTagName, isTagHandle, getTagName, isMountpointHandle, getMountpointId } from './connection';

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a parsed reftag in content (for prompt references)
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
 * Represents a parsed mountpoint in content (for VFS mounting)
 */
export interface ParsedMountpoint {
  /** The mount path (including leading /) */
  path: string;
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
 * This matches prompt reference tags like @system, @context
 */
export const REFTAG_PATTERN = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;

/**
 * Regex pattern for mountpoints: @/ followed by path characters
 * This matches VFS mount tags like @/src, @/config/settings
 */
export const MOUNTPOINT_PATTERN = /@(\/[a-zA-Z0-9_\-./]*)/g;

/**
 * Parse reftags from content string (prompt references only)
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
 * Parse mountpoints from content string (VFS mount references)
 */
export function parseMountpoints(content: string): ParsedMountpoint[] {
  const mountpoints: ParsedMountpoint[] = [];
  let match: RegExpExecArray | null;
  
  // Reset regex lastIndex
  MOUNTPOINT_PATTERN.lastIndex = 0;
  
  while ((match = MOUNTPOINT_PATTERN.exec(content)) !== null) {
    mountpoints.push({
      path: match[1],
      start: match.index,
      end: match.index + match[0].length
    });
  }
  
  return mountpoints;
}

/**
 * Get unique reftag names from content
 */
export function getUniqueRefTagNames(content: string): string[] {
  const reftags = parseRefTags(content);
  const uniqueNames = new Set(reftags.map(h => h.name));
  return Array.from(uniqueNames);
}

/**
 * Get unique mountpoint paths from content
 */
export function getUniqueMountpointPaths(content: string): string[] {
  const mountpoints = parseMountpoints(content);
  const uniquePaths = new Set(mountpoints.map(m => m.path));
  return Array.from(uniquePaths);
}

// ============================================================================
// reftag Edge Utilities (for Prompt Node)
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

// ============================================================================
// Tag Edge Utilities (for Input Node)
// ============================================================================

/**
 * Check if an edge is a tag edge (for Input node)
 */
export function isInputTagEdge(edge: Edge | SnapshotEdge): boolean {
  return isTagHandle(edge.targetHandle);
}

/**
 * Extract tag name from edge's targetHandle
 */
export function getInputTagNameFromEdge(edge: Edge | SnapshotEdge): string | null {
  if (!isInputTagEdge(edge)) return null;
  return getTagName(edge.targetHandle!);
}

/**
 * Get tag connections for an Input node
 * Returns a map of tag name -> connected source node ID
 */
export function getInputTagConnections(
  nodeId: string,
  edges: Edge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (edge.target === nodeId && isInputTagEdge(edge)) {
      const tagName = getInputTagNameFromEdge(edge);
      if (tagName) {
        connections.set(tagName, edge.source);
      }
    }
  }
  
  return connections;
}

/**
 * Get tag connections from snapshot edges (for Input node historical preview)
 * Returns a map of tag name -> connected source node ID
 */
export function getInputTagConnectionsFromSnapshotEdges(
  edges: SnapshotEdge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (isTagHandle(edge.targetHandle)) {
      const tagName = getTagName(edge.targetHandle!);
      connections.set(tagName, edge.source);
    }
  }
  
  return connections;
}

// ============================================================================
// Mountpoint Edge Utilities (for VFS on Input Node)
// ============================================================================

/**
 * Check if an edge is a mountpoint edge (for VFS mounting)
 */
export function isMountpointEdge(edge: Edge | SnapshotEdge): boolean {
  return isMountpointHandle(edge.targetHandle);
}

/**
 * Extract mountpoint ID from edge's targetHandle
 */
export function getMountpointIdFromEdge(edge: Edge | SnapshotEdge): string | null {
  if (!isMountpointEdge(edge)) return null;
  return getMountpointId(edge.targetHandle!);
}

/**
 * Get mountpoint connections for an Input node
 * Returns a map of mountpoint ID -> connected VFS node ID
 */
export function getMountpointConnections(
  nodeId: string,
  edges: Edge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (edge.target === nodeId && isMountpointEdge(edge)) {
      const mountpointId = getMountpointIdFromEdge(edge);
      if (mountpointId) {
        connections.set(mountpointId, edge.source);
      }
    }
  }
  
  return connections;
}

/**
 * Get mountpoint connections from snapshot edges
 * Returns a map of mountpoint ID -> connected VFS node ID
 */
export function getMountpointConnectionsFromSnapshotEdges(
  edges: SnapshotEdge[]
): Map<string, string> {
  const connections = new Map<string, string>();
  
  for (const edge of edges) {
    if (isMountpointHandle(edge.targetHandle)) {
      const mountpointId = getMountpointId(edge.targetHandle!);
      connections.set(mountpointId, edge.source);
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
  
  const promptData = node.data as PromptNodeData;
  let content = promptData.content.text;
  
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
    // Current version matches - extract text from content
    if (node.data.type === 'PROMPT') {
      content = (node.data as PromptNodeData).content.text;
    } else if (node.data.type === 'INPUT') {
      content = (node.data as InputNodeData).content.text;
    } else {
      content = '';
    }
  } else {
    // Get from snapshot store
    const snapshot = snapshotStore.get<PromptContent | InputContent>(nodeId, nodeCommit);
    if (!snapshot) {
      return `[Missing snapshot: ${nodeId}:${nodeCommit.slice(0, 7)}]`;
    }
    content = (snapshot.content as PromptContent | InputContent).text ?? '';
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

// ============================================================================
// Input Node Content Resolution
// ============================================================================

/**
 * Resolve input node content by substituting tags with connected prompt content.
 * Similar to prompt node resolution but uses tag handles instead of reftag handles.
 * 
 * @param nodeId - The input node ID to resolve
 * @param nodes - All nodes in the graph
 * @param edges - All edges in the graph
 * @param visited - Set of already visited node IDs (to prevent infinite loops)
 * @param promptRefs - Accumulator for all prompt refs used (for version tracking)
 */
export function resolveInputContent(
  nodeId: string,
  nodes: Node<StudioNodeData>[],
  edges: Edge[],
  visited: Set<string> = new Set(),
  promptRefs: NodeRef[] = []
): ResolvedPrompt {
  const node = nodes.find(n => n.id === nodeId);
  if (!node || node.data.type !== 'INPUT') {
    return { content: '', allPromptRefs: promptRefs };
  }
  
  const inputData = node.data as InputNodeData;
  let content = inputData.content.text;
  
  // Get tag connections for this input node
  const tagConnections = getInputTagConnections(nodeId, edges);
  
  // No connections - return content as-is
  if (tagConnections.size === 0) {
    return { content, allPromptRefs: promptRefs };
  }
  
  // Parse reftags (@tagname format) and replace from end to start
  const reftags = parseRefTags(content);
  reftags.sort((a, b) => b.start - a.start);
  
  for (const reftag of reftags) {
    const connectedNodeId = tagConnections.get(reftag.name);
    
    if (connectedNodeId) {
      // Recursively resolve the connected prompt (uses prompt node's reftag system)
      const resolved = resolvePromptContent(connectedNodeId, nodes, edges, visited, promptRefs);
      // Replace the tag with resolved content
      content = content.slice(0, reftag.start) + resolved.content + content.slice(reftag.end);
    }
    // If not connected, leave the tag as-is
  }
  
  return { content, allPromptRefs: promptRefs };
}

/**
 * Get all tag names from input content (excluding 'system' as it's always present)
 * Used by InputNode component to determine which prompt handles to show
 */
export function getInputTags(content: string): string[] {
  // Get all unique tags from content, excluding 'system' as it's handled separately
  return getUniqueRefTagNames(content).filter(name => name !== 'system');
}
