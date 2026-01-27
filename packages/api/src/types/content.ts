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
 * Game reference - links text to a game checkpoint
 * saveId 从文章 metadata 中获取，这里只存储 checkpointId
 */
export interface GameRef extends ContentBlock {
  type: 'game_ref';
  /** ID of the text block this reference is attached to */
  textId: string;
  /** Checkpoint ID to load (within the article's saveId) */
  checkpointId: string;
}

/** Union type for all content blocks */
export type ReaderContentBlock = TextContent | GameRef;

/** Reader content - array of content blocks */
export type ReaderContent = ReaderContentBlock[];
