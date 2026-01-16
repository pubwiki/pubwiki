// packages/api/src/types/content.ts

/** Base content block interface */
export interface ContentBlock {
  type: string;
}

/** Plain text content */
export interface TextContent extends ContentBlock {
  type: 'text';
  /** Unique identifier for this text block */
  id: string;
  /** The actual text content (支持 markdown heading: # ## ###) */
  text: string;
}

/**
 * Game reference - links text to a game save state
 * 注意：不存储 projectId 和 sandboxNodeId，这些信息从文章 metadata 中获取
 */
export interface GameRef extends ContentBlock {
  type: 'game_ref';
  /** ID of the text block this reference is attached to */
  textId: string;
  /** Reference to game state (e.g., save file or state snapshot) */
  ref: string;
}

/** Union type for all content blocks */
export type ReaderContentBlock = TextContent | GameRef;

/** Reader content - array of content blocks */
export type ReaderContent = ReaderContentBlock[];
