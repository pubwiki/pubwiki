/**
 * ContentBlock types for structured content storage
 * 
 * This allows separating reftags from regular text, avoiding @ character conflicts.
 */

/**
 * A text block containing plain text
 */
export interface TextBlock {
  type: 'TextBlock';
  value: string;
}

/**
 * A reftag block representing an @reference
 */
export interface RefTagBlock {
  type: 'RefTagBlock';
  name: string;
}

/**
 * Union type for all content blocks
 */
export type ContentBlock = TextBlock | RefTagBlock;

/**
 * Convert ContentBlock array to plain text (for display or generation)
 */
export function blocksToText(blocks: ContentBlock[]): string {
  return blocks.map(block => {
    if (block.type === 'TextBlock') {
      return block.value;
    } else {
      return `@${block.name}`;
    }
  }).join('');
}

/**
 * Extract unique reftag names from blocks
 */
export function getRefTagNamesFromBlocks(blocks: ContentBlock[]): string[] {
  const names = blocks
    .filter((b): b is RefTagBlock => b.type === 'RefTagBlock')
    .map(b => b.name);
  return [...new Set(names)];
}

/**
 * Parse plain text into ContentBlock array using regex
 * This is for backward compatibility with existing text-based content
 */
export function textToBlocks(text: string): ContentBlock[] {
  const REFTAG_PATTERN = /@([a-zA-Z_][a-zA-Z0-9_]*)/g;
  const blocks: ContentBlock[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  
  REFTAG_PATTERN.lastIndex = 0;
  
  while ((match = REFTAG_PATTERN.exec(text)) !== null) {
    // Add text before reftag
    if (match.index > lastIndex) {
      blocks.push({ type: 'TextBlock', value: text.slice(lastIndex, match.index) });
    }
    // Add reftag
    blocks.push({ type: 'RefTagBlock', name: match[1] });
    lastIndex = match.index + match[0].length;
  }
  
  // Add remaining text
  if (lastIndex < text.length) {
    blocks.push({ type: 'TextBlock', value: text.slice(lastIndex) });
  }
  
  return blocks;
}
