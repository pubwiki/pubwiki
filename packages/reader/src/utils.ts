/**
 * Reader Content Utilities
 *
 * Helper functions for working with ReaderContent format.
 */

import type { GameRef, ReaderContent, TextContent } from '@pubwiki/api';

/**
 * Helper to find game ref for a text block
 */
export function findGameRef(content: ReaderContent, textId: string): GameRef | undefined {
	return content.find(
		(block): block is GameRef => block.type === 'game_ref' && block.textId === textId
	);
}

/**
 * Get all text blocks with their associated game refs
 */
export function getTextWithRefs(
	content: ReaderContent
): Array<{ text: TextContent; gameRef?: GameRef }> {
	const textBlocks = content.filter((block): block is TextContent => block.type === 'text');
	return textBlocks.map((text) => ({
		text,
		gameRef: findGameRef(content, text.id),
	}));
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
