/**
 * GameRefParagraphNode - Custom Lexical node for paragraphs with game references
 *
 * Extends ParagraphNode to include game reference metadata.
 * Reuses parent's DOM rendering and adds a play button.
 */

import type {
	EditorConfig,
	LexicalNode,
	NodeKey,
	SerializedParagraphNode,
	Spread,
} from 'lexical';
import { ParagraphNode, $applyNodeReplacement } from 'lexical';
import type { GameRef } from '@pubwiki/api';
import type { ReaderContext } from '../context.js';
import { READER_CONTEXT_KEY } from '../context.js';

// Module-level context for building URLs
// This is set by the Reader component via setReaderContext
let _readerContext: ReaderContext | null = null;

/**
 * Set the reader context for building playback URLs
 * This should be called by the Reader component before creating GameRefParagraphNodes
 */
export function setReaderContext(context: ReaderContext): void {
	_readerContext = context;
}

/**
 * Get the current reader context
 */
export function getReaderContext(): ReaderContext | null {
	return _readerContext;
}

export type SerializedGameRefParagraphNode = Spread<
	{
		type: 'game-ref-paragraph';
		version: 1;
		gameRef: GameRef;
	},
	SerializedParagraphNode
>;

/**
 * Create play button element
 */
function createPlayButton(gameRef: GameRef): HTMLAnchorElement | null {
	const ctx = _readerContext;
	if (!ctx?.buildPlaybackUrl) {
		return null;
	}

	const url = ctx.buildPlaybackUrl(gameRef);
	if (!url) {
		return null;
	}

	const button = document.createElement('a');
	button.className = 'game-ref-button';
	button.href = url;
	button.target = '_blank';
	button.title = '在游戏中查看';
	button.contentEditable = 'false';
	button.innerHTML = `
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<polygon points="5 3 19 12 5 21 5 3"/>
		</svg>
	`;
	return button;
}

export class GameRefParagraphNode extends ParagraphNode {
	__gameRef: GameRef;

	static getType(): string {
		return 'game-ref-paragraph';
	}

	static clone(node: GameRefParagraphNode): GameRefParagraphNode {
		return new GameRefParagraphNode(node.__gameRef, node.__key);
	}

	constructor(gameRef: GameRef, key?: NodeKey) {
		super(key);
		this.__gameRef = gameRef;
	}

	static importJSON(serializedNode: SerializedGameRefParagraphNode): GameRefParagraphNode {
		const node = $createGameRefParagraphNode(serializedNode.gameRef);
		return node;
	}

	exportJSON(): SerializedGameRefParagraphNode {
		return {
			...super.exportJSON(),
			type: 'game-ref-paragraph',
			version: 1,
			gameRef: this.__gameRef,
		};
	}

	createDOM(config: EditorConfig): HTMLElement {
		// Reuse parent's DOM creation
		const dom = super.createDOM(config);
		// Add game-ref class for styling
		dom.classList.add('game-ref-paragraph');
		// Add play button if URL is available
		const button = createPlayButton(this.__gameRef);
		if (button) {
			dom.appendChild(button);
		}
		return dom;
	}

	updateDOM(prevNode: GameRefParagraphNode, dom: HTMLElement, config: EditorConfig): boolean {
		const needsUpdate = super.updateDOM(prevNode, dom, config);
		// Update button if gameRef changed
		if (prevNode.__gameRef !== this.__gameRef) {
			const existingButton = dom.querySelector('.game-ref-button');
			if (existingButton) {
				existingButton.remove();
			}
			const button = createPlayButton(this.__gameRef);
			if (button) {
				dom.appendChild(button);
			}
		}
		return needsUpdate;
	}

	getGameRef(): GameRef {
		return this.__gameRef;
	}
}

export function $createGameRefParagraphNode(gameRef: GameRef): GameRefParagraphNode {
	return $applyNodeReplacement(new GameRefParagraphNode(gameRef));
}

export function $isGameRefParagraphNode(
	node: LexicalNode | null | undefined
): node is GameRefParagraphNode {
	return node instanceof GameRefParagraphNode;
}
