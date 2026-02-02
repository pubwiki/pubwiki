/**
 * reftag Utilities
 * 
 * Provides utilities for parsing and resolving reftag references in prompt content.
 * reftag format: @name - Creates a named input slot for prompt composition (e.g., @system, @context)
 * 
 * Note: VFS mounts are now managed via VFSContent.mounts array and drag-to-folder mounting.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, PromptNodeData, InputNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import type { PromptContent, InputContent } from '../types/content';
import type { NodeRef, SnapshotEdge } from '../version';
import { nodeStore } from '../persistence';
import { isRefTagHandle, getRefTagName, isTagHandle, getTagName, HandleId } from './connection';

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
 * Get unique reftag names from content
 */
export function getUniqueRefTagNames(content: string): string[] {
  const reftags = parseRefTags(content);
  const uniqueNames = new Set(reftags.map(h => h.name));
  return Array.from(uniqueNames);
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
 * Only matches regular tag handles (tag-*), not system-prompt
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
 * Does NOT include SYSTEM_TAG - use getSystemPromptConnection for that
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
 * Get the system prompt connection for an Input node
 * Returns the source node ID connected to SYSTEM_TAG handle, or null if not connected
 */
export function getSystemPromptConnection(
  nodeId: string,
  edges: Edge[]
): string | null {
  for (const edge of edges) {
    if (edge.target === nodeId && edge.targetHandle === HandleId.SYSTEM_TAG) {
      return edge.source;
    }
  }
  return null;
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
  const blocks = promptData.content.blocks;
  
  // Add this node's ref
  promptRefs.push({ id: nodeId, commit: promptData.commit });
  
  // Get reftag connections
  const connections = getRefTagConnections(nodeId, edges);
  
  // No connections - return content as-is
  if (connections.size === 0) {
    return { content: promptData.content.getText(), allPromptRefs: promptRefs };
  }
  
  // Resolve blocks by replacing reftags with connected content
  let resolvedContent = '';
  for (const block of blocks) {
    if (block.type === 'text') {
      resolvedContent += block.value;
    } else if (block.type === 'reftag') {
      const connectedNodeId = connections.get(block.name);
      if (connectedNodeId) {
        // Recursively resolve the connected prompt
        const resolved = resolvePromptContent(connectedNodeId, nodes, edges, visited, promptRefs);
        resolvedContent += resolved.content;
      } else {
        // If not connected, keep the @name format
        resolvedContent += `@${block.name}`;
      }
    }
  }
  
  return { content: resolvedContent, allPromptRefs: promptRefs };
}

/**
 * Resolve prompt content using historical versions from refs.
 * Used for regeneration to reproduce exact historical context.
 * 
 * After layer separation:
 * - Uses FlowNodeData for flow layer
 * - Uses nodeStore for current business data
 * 
 * After version-store-unification:
 * - Now async, uses nodeStore.getVersion() for historical versions
 */
export async function resolvePromptContentFromRefs(
  nodeId: string,
  nodeCommit: string,
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  allRefs: NodeRef[],
  visited: Set<string> = new Set()
): Promise<string> {
  if (visited.has(nodeId)) {
    return `[Circular reference]`;
  }
  visited.add(nodeId);
  
  // Find the content for this ref
  let blocks: ContentBlock[] | null = null;
  let textContent: string = '';
  const nodeData = nodeStore.get(nodeId);
  
  if (nodeData && nodeData.commit === nodeCommit) {
    // Current version matches - extract blocks/text from content
    if (nodeData.type === 'PROMPT') {
      blocks = (nodeData as PromptNodeData).content.blocks;
    } else if (nodeData.type === 'INPUT') {
      blocks = (nodeData as InputNodeData).content.blocks;
    } else {
      textContent = '';
    }
  } else {
    // Get from nodeStore (historical version)
    const snapshot = await nodeStore.getVersion(nodeId, nodeCommit);
    if (!snapshot) {
      return `[Missing snapshot: ${nodeId}:${nodeCommit.slice(0, 7)}]`;
    }
    // Content is now a class instance with getText() method
    textContent = snapshot.content.getText();
  }
  
  // Get reftag connections (using current edges since we don't store edge history)
  const connections = getRefTagConnections(nodeId, edges);
  
  // If we have blocks (PROMPT node), resolve using blocks
  if (blocks !== null) {
    if (connections.size === 0) {
      return blocksToTextLocal(blocks);
    }
    
    let resolvedContent = '';
    for (const block of blocks) {
      if (block.type === 'text') {
        resolvedContent += block.value;
      } else if (block.type === 'reftag') {
        const connectedNodeId = connections.get(block.name);
        if (connectedNodeId) {
          const ref = allRefs.find(r => r.id === connectedNodeId);
          if (ref) {
            const resolved = await resolvePromptContentFromRefs(
              connectedNodeId,
              ref.commit,
              nodes,
              edges,
              allRefs,
              visited
            );
            resolvedContent += resolved;
          } else {
            resolvedContent += `@${block.name}`;
          }
        } else {
          resolvedContent += `@${block.name}`;
        }
      }
    }
    return resolvedContent;
  }
  
  // For non-PROMPT nodes or historical versions, use text-based parsing
  if (connections.size === 0) {
    return textContent;
  }
  
  // Parse and replace reftags
  const reftags = parseRefTags(textContent);
  reftags.sort((a, b) => b.start - a.start);
  
  for (const reftag of reftags) {
    const connectedNodeId = connections.get(reftag.name);
    
    if (connectedNodeId) {
      // Find the ref for this connected node
      const ref = allRefs.find(r => r.id === connectedNodeId);
      if (ref) {
        const resolvedContent = await resolvePromptContentFromRefs(
          connectedNodeId,
          ref.commit,
          nodes,
          edges,
          allRefs,
          visited
        );
        textContent = textContent.slice(0, reftag.start) + resolvedContent + textContent.slice(reftag.end);
      }
    }
  }
  
  return textContent;
}

// Helper function for local use
function blocksToTextLocal(blocks: ContentBlock[]): string {
  return blocks.map(block => 
    block.type === 'text' ? block.value : `@${block.name}`
  ).join('');
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
  let content = blocksToText(inputData.content.blocks);
  
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

// ============================================================================
// ContentBlock Support
// ============================================================================

import type { ContentBlock } from '$components/editor';

/**
 * Get unique reftag names from ContentBlock array
 * This is the new preferred method that doesn't rely on regex parsing
 */
export function getRefTagNamesFromBlocks(blocks: ContentBlock[]): string[] {
  const names = blocks
    .filter((b): b is { type: 'reftag'; name: string } => b.type === 'reftag')
    .map(b => b.name);
  return [...new Set(names)];
}

/**
 * Get all tag names from input content blocks
 * Used by InputNode component to determine which prompt handles to show
 */
export function getInputTagsFromBlocks(blocks: ContentBlock[]): string[] {
  return getRefTagNamesFromBlocks(blocks);
}

/**
 * Resolve content blocks by substituting reftags with connected prompt content.
 * This is the new version that works with structured ContentBlock[] format.
 */
export function resolveContentBlocks(
  blocks: ContentBlock[],
  connections: Map<string, string>,
  resolver: (nodeId: string) => string
): string {
  return blocks.map(block => {
    if (block.type === 'text') {
      return block.value;
    } else {
      const connectedNodeId = connections.get(block.name);
      if (connectedNodeId) {
        return resolver(connectedNodeId);
      }
      // If not connected, preserve original @name format
      return `@${block.name}`;
    }
  }).join('');
}

/**
 * Convert ContentBlock[] to plain text
 */
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'text') {
      return block.value;
    } else {
      return `@${block.name}`;
    }
  }).join('');
}
