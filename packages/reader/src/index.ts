/**
 * @pubwiki/reader - Shared Reader component and utilities
 *
 * Provides a Lexical-based reader component for viewing article content,
 * with support for game reference annotations.
 */

// Re-export types from @pubwiki/api
export type {
	TextContent,
	GameRef,
	ReaderContentBlock,
	ReaderContent,
} from '@pubwiki/api';

// Export utility functions and types
export {
	findGameRef,
	getTextWithRefs,
	extractToc,
	type TocItem,
} from './utils.js';

// Export context utilities
export {
	READER_CONTEXT_KEY,
	type ReaderContext,
} from './context.js';

// Export Reader component
export { default as Reader } from './Reader.svelte';

// Export Lexical nodes for advanced usage
export {
	GameRefParagraphNode,
	$createGameRefParagraphNode,
	$isGameRefParagraphNode,
	type SerializedGameRefParagraphNode,
} from './nodes/GameRefParagraphNode.js';
