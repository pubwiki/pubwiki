/**
 * Content utilities for Lexical ↔ ReaderContent conversion
 *
 * Shared by Reader (read-only) and Editor (writable) components.
 */

import {
	$getRoot as getRoot,
	$createParagraphNode as createParagraphNode,
	$createTextNode as createTextNode,
	$isParagraphNode as isParagraphNode,
} from 'lexical';
import {
	HeadingNode,
	$createHeadingNode as createHeadingNode,
	$isHeadingNode as isHeadingNode,
} from '@lexical/rich-text';
import {
	$createGameRefParagraphNode as createGameRefParagraphNode,
	$isGameRefParagraphNode as isGameRefParagraphNode,
} from './nodes/GameRefParagraphNode.js';
import type { ReaderContent, ReaderContentBlock, TextContent, GameRef } from '@pubwiki/api';
import { getTextWithRefs } from './utils.js';

/**
 * Parse ReaderContent and populate Lexical editor state.
 * Must be called within an editor.update() callback.
 */
export function initializeContent(readerContent: ReaderContent): void {
	const root = getRoot();
	root.clear();

	const textWithRefs = getTextWithRefs(readerContent);

	for (const { text, gameRef } of textWithRefs) {
		const lines = text.text.split('\n');
		let gameRefUsed = false;

		for (const line of lines) {
			if (line.startsWith('# ')) {
				const heading = createHeadingNode('h1');
				heading.append(createTextNode(line.slice(2)));
				root.append(heading);
			} else if (line.startsWith('## ')) {
				const heading = createHeadingNode('h2');
				heading.append(createTextNode(line.slice(3)));
				root.append(heading);
			} else if (line.startsWith('### ')) {
				const heading = createHeadingNode('h3');
				heading.append(createTextNode(line.slice(4)));
				root.append(heading);
			} else if (line.startsWith('---')) {
				const hr = createParagraphNode();
				hr.append(createTextNode('⸻'));
				root.append(hr);
			} else if (line.trim()) {
				if (gameRef && !gameRefUsed) {
					const paragraph = createGameRefParagraphNode(gameRef);
					paragraph.append(createTextNode(line));
					root.append(paragraph);
					gameRefUsed = true;
				} else {
					const paragraph = createParagraphNode();
					paragraph.append(createTextNode(line));
					root.append(paragraph);
				}
			} else {
				const paragraph = createParagraphNode();
				root.append(paragraph);
			}
		}
	}
}

let _idCounter = 0;

function generateTextId(): string {
	return `text-${Date.now()}-${_idCounter++}`;
}

/**
 * Export Lexical editor state back to ReaderContent.
 * Must be called within an editor.read() or editor.update() callback.
 */
export function exportContent(): ReaderContent {
	const root = getRoot();
	const children = root.getChildren();
	const content: ReaderContentBlock[] = [];

	// Track consecutive paragraphs that belong to the same logical text block.
	// A new text block starts when the node type changes or a game-ref paragraph is encountered.
	let currentTextId: string | null = null;
	let currentLines: string[] = [];

	function flushText() {
		if (currentTextId !== null && currentLines.length > 0) {
			content.push({
				type: 'text' as const,
				id: currentTextId,
				text: currentLines.join('\n'),
			});
		}
		currentTextId = null;
		currentLines = [];
	}

	for (const child of children) {
		if (isHeadingNode(child)) {
			flushText();
			const tag = child.getTag(); // 'h1' | 'h2' | 'h3'
			const prefix = tag === 'h1' ? '# ' : tag === 'h2' ? '## ' : '### ';
			const textId = generateTextId();
			content.push({
				type: 'text' as const,
				id: textId,
				text: prefix + child.getTextContent(),
			} satisfies TextContent);
		} else if (isGameRefParagraphNode(child)) {
			flushText();
			const textId = generateTextId();
			const text = child.getTextContent();
			content.push({
				type: 'text' as const,
				id: textId,
				text,
			} satisfies TextContent);
			content.push({
				type: 'game_ref' as const,
				textId,
				saveCommit: child.getGameRef().saveCommit,
			} satisfies GameRef);
		} else if (isParagraphNode(child)) {
			const text = child.getTextContent();
			if (!currentTextId) {
				currentTextId = generateTextId();
			}
			currentLines.push(text);
		}
	}

	flushText();
	return content;
}

/** Lexical nodes required for content rendering */
export { HeadingNode };
