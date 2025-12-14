/**
 * UI Types for @pubwiki/svelte-chat
 * 
 * These types are specific to the UI rendering layer and should not be in @pubwiki/chat core.
 */

import type { MessageBlock as CoreMessageBlock, MessageBlockType as CoreMessageBlockType } from '@pubwiki/chat'

// ===== Extended Block Types for UI =====

/**
 * Extended message block types for UI rendering
 * Includes additional types beyond the core library
 */
export type UIMessageBlockType = 
  | CoreMessageBlockType
  | 'html'           // HTML content
  | 'table'          // Table data
  | 'list'           // List
  | 'iteration_limit_prompt'  // Iteration limit prompt (interactive)
  | 'custom'         // Custom renderer

/**
 * Extended MessageBlock for UI with additional block types
 */
export interface UIMessageBlock extends Omit<CoreMessageBlock, 'type'> {
  type: UIMessageBlockType
}

/**
 * Render group type (for UI rendering to merge tool_call + tool_result)
 */
export type RenderGroup = 
  | { id: string; type: 'single'; block: UIMessageBlock }
  | { id: string; type: 'tool_call_group'; toolCallBlock: UIMessageBlock; toolResultBlock?: UIMessageBlock }

// ===== Utility Functions =====

/**
 * Generate unique block ID
 */
export function generateBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`
}

/**
 * Group blocks for rendering
 * 
 * Grouping rules:
 * - tool_call + corresponding tool_result merged into one group
 * - Other blocks form individual groups
 * 
 * This allows UI to display tool_call and its result in the same component
 */
export function groupBlocksForRender(blocks: UIMessageBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  const toolResultMap = new Map<string, UIMessageBlock>()  // toolCallId -> tool_result block
  
  // Collect all tool_results
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.toolCallId) {
      toolResultMap.set(block.toolCallId, block)
    }
  }
  
  // Iterate blocks, build groups (preserve array order)
  for (const block of blocks) {
    if (block.type === 'tool_result') {
      // tool_result already merged with tool_call, skip
      continue
    }
    
    if (block.type === 'tool_call') {
      // tool_call merged with corresponding tool_result
      const resultBlock = block.toolCallId 
        ? toolResultMap.get(block.toolCallId) 
        : undefined
      
      groups.push({
        id: block.id,
        type: 'tool_call_group',
        toolCallBlock: block,
        toolResultBlock: resultBlock  // May be undefined (tool still executing)
      })
    } else {
      // Other blocks form individual groups
      groups.push({
        id: block.id,
        type: 'single',
        block
      })
    }
  }
  
  return groups
}

/**
 * Create an image block
 */
export function createImageBlock(
  url: string,
  metadata?: Record<string, unknown>
): UIMessageBlock {
  return {
    id: generateBlockId(),
    type: 'image',
    content: url,
    metadata
  }
}

/**
 * Extract text content from blocks
 */
export function blocksToContent(blocks: UIMessageBlock[]): string {
  return blocks
    .filter(b => b.type === 'text' || b.type === 'markdown')
    .map(b => b.content)
    .join('')
}

/**
 * Extract code content from blocks
 */
export function blocksToCode(blocks: UIMessageBlock[]): { code: string; language?: string }[] {
  return blocks
    .filter(b => b.type === 'code')
    .map(b => {
      try {
        const data = JSON.parse(b.content)
        return { code: data.code || b.content, language: data.language }
      } catch {
        return { code: b.content }
      }
    })
}
