/**
 * Reader Content Types
 * 
 * Content format for novel reading, supporting game reference annotations.
 * Novels are compiled from galgame-style game history records.
 */

/** Base content block interface */
export interface ContentBlock {
    type: string;
}

/** Plain text content */
export interface TextContent extends ContentBlock {
    type: 'text';
    /** Unique identifier for this text block */
    id: string;
    /** The actual text content */
    text: string;
}

/** Game reference - links text to a game save state */
export interface GameRef extends ContentBlock {
    type: 'game_ref';
    /** ID of the text block this reference is attached to */
    textId: string;
    /** Reference to game state (e.g., save file or state snapshot) */
    ref: string;
    /** Project ID in studio */
    projectId: string;
    /** Sandbox node ID for playback */
    sandboxNodeId: string;
}

/** Union type for all content blocks */
export type ReaderContentBlock = TextContent | GameRef;

/** Reader content - array of content blocks */
export type ReaderContent = ReaderContentBlock[];

/**
 * Helper to find game ref for a text block
 */
export function findGameRef(content: ReaderContent, textId: string): GameRef | undefined {
    return content.find((block): block is GameRef => 
        block.type === 'game_ref' && block.textId === textId
    );
}

/**
 * Get all text blocks with their associated game refs
 */
export function getTextWithRefs(content: ReaderContent): Array<{ text: TextContent; gameRef?: GameRef }> {
    const textBlocks = content.filter((block): block is TextContent => block.type === 'text');
    return textBlocks.map(text => ({
        text,
        gameRef: findGameRef(content, text.id)
    }));
}

/**
 * Build studio playback URL for a game ref
 */
export function buildPlaybackUrl(gameRef: GameRef): string {
    return `/${gameRef.projectId}/play/${gameRef.sandboxNodeId}?load=${encodeURIComponent(gameRef.ref)}`;
}

/** Table of contents item */
export interface TocItem {
    id: string;
    title: string;
    level: 1 | 2 | 3;
}

/**
 * Extract table of contents from reader content
 * Parses markdown-style headings (# ## ###) from text blocks
 */
export function extractToc(content: ReaderContent): TocItem[] {
    const toc: TocItem[] = [];
    
    for (const block of content) {
        if (block.type !== 'text') continue;
        
        const text = block.text;
        if (text.startsWith('# ')) {
            toc.push({ id: block.id, title: text.slice(2), level: 1 });
        } else if (text.startsWith('## ')) {
            toc.push({ id: block.id, title: text.slice(3), level: 2 });
        } else if (text.startsWith('### ')) {
            toc.push({ id: block.id, title: text.slice(4), level: 3 });
        }
    }
    
    return toc;
}
