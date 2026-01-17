<script lang="ts">
	/**
	 * Reader - Rich text reader component using Lexical
	 * 
	 * A read-only text viewer optimized for long-form content reading.
	 * Features:
	 * - Clean typography for comfortable reading
	 * - Support for structured ReaderContent format
	 * - Game reference buttons for linked text blocks
	 * - Read-only mode by default
	 */
	import { onMount } from 'svelte';
	import {
		Composer,
		ContentEditable,
		RichTextPlugin,
	} from 'svelte-lexical';
	import {
		$getRoot as getRoot,
		$createParagraphNode as createParagraphNode,
		$createTextNode as createTextNode,
		type LexicalEditor,
	} from 'lexical';
	import { HeadingNode, $createHeadingNode as createHeadingNode } from '@lexical/rich-text';
	import { GameRefParagraphNode, $createGameRefParagraphNode as createGameRefParagraphNode, setArticleContext } from './GameRefParagraphNode';
	import { type ReaderContent, type TextContent, getTextWithRefs } from './content';

	interface Props {
		/** Structured reader content */
		content: ReaderContent;
		/** Artifact ID for playback links */
		artifactId: string;
		/** Sandbox node ID for playback links */
		sandboxNodeId: string;
		/** Additional CSS class */
		class?: string;
	}

	let {
		content = [],
		artifactId,
		sandboxNodeId,
		class: className = '',
	}: Props = $props();

	let composer: Composer | undefined = $state();
	let editorRef: LexicalEditor | null = null;

	// Editor theme for typography
	const theme = {
		paragraph: 'reader-paragraph',
		text: {
			base: 'reader-text',
			bold: 'reader-bold',
			italic: 'reader-italic',
		},
		heading: {
			h1: 'reader-h1',
			h2: 'reader-h2',
			h3: 'reader-h3',
		},
	};

	// Editor configuration
	const initialConfig = {
		namespace: 'Reader',
		theme,
		nodes: [HeadingNode, GameRefParagraphNode],
		onError: (error: Error) => {
			console.error('Reader error:', error);
		},
		editable: false, // Read-only mode
	};

	onMount(() => {
		if (composer) {
			const editor = composer.getEditor();
			editorRef = editor;
			
			// Ensure editor is read-only
			editor.setEditable(false);

			// Set article context for playback URLs
			setArticleContext(artifactId, sandboxNodeId);

			// Initialize content
			if (Array.isArray(content) && content.length > 0) {
				initializeContent(editor, content);
			}
		}
	});

	/**
	 * Parse ReaderContent and initialize editor
	 */
	function initializeContent(editor: LexicalEditor, readerContent: ReaderContent) {
		editor.update(() => {
			const root = getRoot();
			root.clear();

			const textWithRefs = getTextWithRefs(readerContent);

			for (const { text, gameRef } of textWithRefs) {
				const lines = text.text.split('\n');
				
				for (const line of lines) {
					// Check for headings (simple markdown support)
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
						// Horizontal rule
						const hr = createParagraphNode();
						hr.append(createTextNode('⸻'));
						root.append(hr);
					} else if (line.trim()) {
						// Regular paragraph - use GameRefParagraphNode if has gameRef
						if (gameRef) {
							const paragraph = createGameRefParagraphNode(gameRef);
							paragraph.append(createTextNode(line));
							root.append(paragraph);
						} else {
							const paragraph = createParagraphNode();
							paragraph.append(createTextNode(line));
							root.append(paragraph);
						}
					} else {
						// Empty line
						const paragraph = createParagraphNode();
						root.append(paragraph);
					}
				}
			}
		}, { discrete: true });
	}
</script>

<div class="reader {className}">
	<Composer {initialConfig} bind:this={composer}>
		<div class="reader-inner">
			<ContentEditable />
			<RichTextPlugin />
		</div>
	</Composer>
</div>

<style>
	.reader {
		position: relative;
		width: 100%;
		font-family: var(--reader-font-family, 'Noto Serif SC', 'Source Han Serif CN', 'Songti SC', Georgia, 'Times New Roman', serif);
	}

	.reader-inner {
		outline: none;
	}

	.reader :global([contenteditable]) {
		outline: none;
		cursor: default;
	}

	/* Typography styles */
	.reader :global(.reader-paragraph) {
		position: relative;
		margin: 0 0 1.5em 0;
		font-size: var(--reader-font-size, 1.125rem);
		line-height: 1.9;
		color: var(--reader-text-color, #333);
		text-align: left !important;
	}

	.reader :global(.reader-paragraph:empty) {
		margin: 0 0 0.75em 0;
	}

	.reader :global(.reader-h1) {
		font-size: calc(var(--reader-font-size, 1.125rem) * 1.55);
		font-weight: 700;
		color: var(--reader-heading-color, #1a1a1a);
		margin: 2.5rem 0 1.5rem 0;
		line-height: 1.4;
		text-align: center;
	}

	.reader :global(.reader-h1:first-child) {
		margin-top: 0;
	}

	.reader :global(.reader-h2) {
		font-size: calc(var(--reader-font-size, 1.125rem) * 1.22);
		font-weight: 600;
		color: var(--reader-heading-color, #2a2a2a);
		margin: 2rem 0 1rem 0;
		line-height: 1.5;
		padding-left: 0.75rem;
		border-left: 3px solid #0969da;
	}

	.reader :global(.reader-h3) {
		font-size: var(--reader-font-size, 1.125rem);
		font-weight: 600;
		color: var(--reader-heading-color, #3a3a3a);
		margin: 1.5rem 0 0.75rem 0;
		line-height: 1.5;
	}

	.reader :global(.reader-bold) {
		font-weight: 700;
	}

	.reader :global(.reader-italic) {
		font-style: italic;
	}

	/* Horizontal rule styling */
	.reader :global(.reader-paragraph:has(> span:only-child)) {
		text-align: center;
	}

	/* Selection style for read-only */
	.reader :global(::selection) {
		background-color: rgba(9, 105, 218, 0.15);
	}

	/* Game ref paragraph - with indicator line on top */
	.reader :global(.game-ref-paragraph) {
		padding-top: 0.75rem;
		border-top: 1px solid var(--reader-border-color, #e0e7ef);
	}

	/* Game ref button - play icon positioned outside on the right, like a hanging flag */
	.reader :global(.game-ref-paragraph .game-ref-button) {
		position: absolute;
		right: -3rem;
		top: -1px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		border-radius: 0;
		border: 1px solid var(--reader-button-border, rgba(0, 0, 0, 0.12));
		background-color: transparent;
		color: var(--reader-button-color, rgba(0, 0, 0, 0.4));
		text-decoration: none;
		transition: all 0.2s ease;
	}

	.reader :global(.game-ref-button:hover) {
		background-color: var(--reader-button-hover-bg, rgba(0, 0, 0, 0.05));
		color: var(--reader-button-hover-color, rgba(0, 0, 0, 0.6));
	}

	.reader :global(.game-ref-button svg) {
		width: 16px;
		height: 16px;
	}
</style>
