/**
 * Content Resolution Utilities
 * 
 * Studio-specific functions for resolving reftag references in content.
 * These functions need access to node data and cannot be in flow-core.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { StudioNodeData, PromptNodeData, InputNodeData } from '../types';
import type { FlowNodeData } from '../types/flow';
import type { NodeRef } from '../version/types';
import type { ResolvedPrompt, ContentBlock } from '@pubwiki/flow-core';
import {
  getRefTagConnections,
  getInputTagConnections,
  parseRefTags,
  blocksToText
} from '@pubwiki/flow-core';
import { nodeStore } from '../persistence';

// ============================================================================
// Content Resolution (Studio-specific)
// ============================================================================

/**
 * Resolve prompt content by substituting reftags with connected content.
 * Returns the fully resolved content and all prompt refs encountered.
 * 
 * @param promptNodeId - The prompt node to resolve
 * @param nodes - All nodes in the graph
 * @param edges - All edges in the graph
 * @param visited - Set of already visited node IDs (for cycle detection)
 * @param collectedRefs - Array to collect encountered prompt refs
 * @returns Resolved content and all prompt refs
 */
export function resolvePromptContent(
  promptNodeId: string,
  nodes: Node<StudioNodeData>[],
  edges: Edge[],
  visited: Set<string>,
  collectedRefs: NodeRef[]
): ResolvedPrompt {
  // Cycle detection
  if (visited.has(promptNodeId)) {
    return { content: '', allPromptRefs: collectedRefs };
  }
  visited.add(promptNodeId);

  const promptNode = nodes.find(n => n.id === promptNodeId);
  if (!promptNode || promptNode.data.type !== 'PROMPT') {
    return { content: '', allPromptRefs: collectedRefs };
  }

  const promptData = promptNode.data as PromptNodeData;
  collectedRefs.push({ id: promptNodeId, commit: promptData.commit });

  // Get reftag connections for this prompt
  const refTagConnections = getRefTagConnections(promptNodeId, edges);
  
  // Resolve blocks
  const blocks = promptData.content.blocks || [];
  let resolvedContent = '';
  
  for (const block of blocks) {
    if (block.type === 'TextBlock') {
      resolvedContent += block.value;
    } else if (block.type === 'RefTagBlock') {
      const connectedNodeId = refTagConnections.get(block.name);
      if (connectedNodeId) {
        // Recursively resolve the connected prompt
        const resolved = resolvePromptContent(
          connectedNodeId,
          nodes,
          edges,
          visited,
          collectedRefs
        );
        resolvedContent += resolved.content;
      } else {
        // If not connected, keep the @name format
        resolvedContent += `@${block.name}`;
      }
    }
  }

  return { content: resolvedContent, allPromptRefs: collectedRefs };
}

/**
 * Resolve prompt content from NodeRef array (for version preview/regeneration).
 * Uses historical snapshots to resolve content at specific versions.
 * 
 * @param nodeId - The node ID to resolve
 * @param nodeCommit - The commit hash to use
 * @param nodes - All flow nodes
 * @param edges - All edges
 * @param allRefs - All refs available for resolution
 * @param visited - Visited set for cycle detection
 * @returns Resolved content string
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
      return blocksToText(blocks);
    }
    
    let resolvedContent = '';
    for (const block of blocks) {
      if (block.type === 'TextBlock') {
        resolvedContent += block.value;
      } else if (block.type === 'RefTagBlock') {
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
        const resolved = await resolvePromptContentFromRefs(
          connectedNodeId,
          ref.commit,
          nodes,
          edges,
          allRefs,
          visited
        );
        textContent = textContent.slice(0, reftag.start) + resolved + textContent.slice(reftag.end);
      }
    }
  }
  
  return textContent;
}

/**
 * Resolve input content by substituting tags with connected prompt content.
 * Tags in input are resolved to their connected prompt content.
 * 
 * @param inputNodeId - The input node to resolve
 * @param nodes - All nodes in the graph
 * @param edges - All edges in the graph
 * @param visited - Set of already visited node IDs (for cycle detection)
 * @param collectedRefs - Array to collect encountered prompt refs
 * @returns Resolved content and all prompt refs
 */
export function resolveInputContent(
  inputNodeId: string,
  nodes: Node<StudioNodeData>[],
  edges: Edge[],
  visited: Set<string>,
  collectedRefs: NodeRef[]
): ResolvedPrompt {
  const inputNode = nodes.find(n => n.id === inputNodeId);
  if (!inputNode || inputNode.data.type !== 'INPUT') {
    return { content: '', allPromptRefs: collectedRefs };
  }

  const inputData = inputNode.data as InputNodeData;
  
  // Get tag connections for the input node
  const tagConnections = getInputTagConnections(inputNodeId, edges);
  
  // Resolve blocks
  const blocks = inputData.content.blocks || [];
  let resolvedContent = '';
  
  for (const block of blocks) {
    if (block.type === 'TextBlock') {
      resolvedContent += block.value;
    } else if (block.type === 'RefTagBlock') {
      const connectedNodeId = tagConnections.get(block.name);
      if (connectedNodeId) {
        // Resolve the connected prompt
        const resolved = resolvePromptContent(
          connectedNodeId,
          nodes,
          edges,
          new Set(visited), // New visited set for each branch
          collectedRefs
        );
        resolvedContent += resolved.content;
      } else {
        // If not connected, keep the @name format
        resolvedContent += `@${block.name}`;
      }
    }
  }

  return { content: resolvedContent, allPromptRefs: collectedRefs };
}
