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
 * Game reference - links text to a specific Save node version
 * 使用 saveCommit 唯一定位到具体的存档版本
 */
export interface GameRef extends ContentBlock {
  type: 'game_ref';
  /** ID of the text block this reference is attached to */
  textId: string;
  /** Save version commit hash */
  saveCommit: string;
}

/** Union type for all content blocks */
export type ReaderContentBlock = TextContent | GameRef;

/** Reader content - array of content blocks */
export type ReaderContent = ReaderContentBlock[];
