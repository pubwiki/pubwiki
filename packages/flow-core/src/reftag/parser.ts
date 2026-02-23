/**
 * RefTag Utilities
 * 
 * Provides utilities for parsing and resolving reftag references in prompt content.
 * reftag format: @name - Creates a named input slot for prompt composition
 */

import type { GraphEdge } from '../types/edge'
import type { SnapshotEdge, NodeRef } from '../types/version'
import { 
  type ContentBlock,
  blocksToText,
  getRefTagNamesFromBlocks 
} from '../types/content'
import { 
  isRefTagHandle, 
  getRefTagName, 
  isTagHandle, 
  getTagName, 
  HandleId 
} from '../registry/connection'

// Re-export from content for convenience
export { blocksToText, getRefTagNamesFromBlocks }

// ============================================================================
// Types
// ============================================================================

/**
 * Represents a parsed reftag in content
 */
export interface ParsedRefTag {
  /** The reftag name (without @) */
  name: string
  /** Start position in the content */
  start: number
  /** End position in the content */
  end: number
}

/**
 * Result of resolving prompt content with reftag substitutions
 */
export interface ResolvedPrompt {
  /** The fully resolved content with reftags replaced */
  content: string
  /** All prompt refs used (including indirect ones from nested reftags) */
  allPromptRefs: NodeRef[]
}

// ============================================================================
// RefTag Parsing
// ============================================================================

/**
 * Regex pattern for reftags: @ followed by word characters
 */
export const REFTAG_PATTERN = /@([a-zA-Z_][a-zA-Z0-9_]*)/g

/**
 * Parse reftags from content string
 */
export function parseRefTags(content: string): ParsedRefTag[] {
  const reftags: ParsedRefTag[] = []
  let match: RegExpExecArray | null
  
  REFTAG_PATTERN.lastIndex = 0
  
  while ((match = REFTAG_PATTERN.exec(content)) !== null) {
    reftags.push({
      name: match[1],
      start: match.index,
      end: match.index + match[0].length
    })
  }
  
  return reftags
}

/**
 * Get unique reftag names from content
 */
export function getUniqueRefTagNames(content: string): string[] {
  const reftags = parseRefTags(content)
  const uniqueNames = new Set(reftags.map(h => h.name))
  return Array.from(uniqueNames)
}

// ============================================================================
// Edge Utilities
// ============================================================================

/**
 * Check if an edge is a reftag edge
 */
export function isRefTagEdge(edge: GraphEdge | SnapshotEdge): boolean {
  return isRefTagHandle(edge.targetHandle)
}

/**
 * Extract reftag name from edge's targetHandle
 */
export function getRefTagNameFromEdge(edge: GraphEdge | SnapshotEdge): string | null {
  if (!isRefTagEdge(edge)) return null
  return getRefTagName(edge.targetHandle!)
}

/**
 * Get reftag connections for a node
 * Returns a map of reftag name -> connected source node ID
 */
export function getRefTagConnections(
  nodeId: string,
  edges: GraphEdge[]
): Map<string, string> {
  const connections = new Map<string, string>()
  
  for (const edge of edges) {
    if (edge.target === nodeId && isRefTagEdge(edge)) {
      const refTagName = getRefTagNameFromEdge(edge)
      if (refTagName) {
        connections.set(refTagName, edge.source)
      }
    }
  }
  
  return connections
}

/**
 * Get reftag connections from snapshot edges
 */
export function getRefTagConnectionsFromSnapshotEdges(
  edges: SnapshotEdge[]
): Map<string, string> {
  const connections = new Map<string, string>()
  
  for (const edge of edges) {
    if (isRefTagHandle(edge.targetHandle)) {
      const refTagName = getRefTagName(edge.targetHandle!)
      connections.set(refTagName, edge.source)
    }
  }
  
  return connections
}

// ============================================================================
// Tag Edge Utilities (for Input Node)
// ============================================================================

/**
 * Check if an edge is a tag edge (for Input node)
 */
export function isInputTagEdge(edge: GraphEdge | SnapshotEdge): boolean {
  return isTagHandle(edge.targetHandle)
}

/**
 * Extract tag name from edge's targetHandle
 */
export function getInputTagNameFromEdge(edge: GraphEdge | SnapshotEdge): string | null {
  if (!isInputTagEdge(edge)) return null
  return getTagName(edge.targetHandle!)
}

/**
 * Get tag connections for an Input node
 */
export function getInputTagConnections(
  nodeId: string,
  edges: GraphEdge[]
): Map<string, string> {
  const connections = new Map<string, string>()
  
  for (const edge of edges) {
    if (edge.target === nodeId && isInputTagEdge(edge)) {
      const tagName = getInputTagNameFromEdge(edge)
      if (tagName) {
        connections.set(tagName, edge.source)
      }
    }
  }
  
  return connections
}

/**
 * Get the system prompt connection for an Input node
 */
export function getSystemPromptConnection(
  nodeId: string,
  edges: GraphEdge[]
): string | null {
  for (const edge of edges) {
    if (edge.target === nodeId && edge.targetHandle === HandleId.SYSTEM_TAG) {
      return edge.source
    }
  }
  return null
}

/**
 * Get tag connections from snapshot edges
 */
export function getInputTagConnectionsFromSnapshotEdges(
  edges: SnapshotEdge[]
): Map<string, string> {
  const connections = new Map<string, string>()
  
  for (const edge of edges) {
    if (isTagHandle(edge.targetHandle)) {
      const tagName = getTagName(edge.targetHandle!)
      connections.set(tagName, edge.source)
    }
  }
  
  return connections
}

// ============================================================================
// ContentBlock Support
// ============================================================================

/**
 * Get all tag names from input content blocks
 */
export function getInputTagsFromBlocks(blocks: ContentBlock[]): string[] {
  return getRefTagNamesFromBlocks(blocks)
}

/**
 * Resolve content blocks by substituting reftags with connected content.
 */
export function resolveContentBlocks(
  blocks: ContentBlock[],
  connections: Map<string, string>,
  resolver: (nodeId: string) => string
): string {
  return blocks.map(block => {
    if (block.type === 'TextBlock') {
      return block.value
    } else {
      const connectedNodeId = connections.get(block.name)
      if (connectedNodeId) {
        return resolver(connectedNodeId)
      }
      return `@${block.name}`
    }
  }).join('')
}
