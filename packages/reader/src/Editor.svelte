<script lang="ts">
	/**
	 * Editor - Writable rich text editor component using Lexical
	 *
	 * An editable variant of Reader for authoring article content.
	 * Features:
	 * - Same typography and theme as Reader
	 * - Editable text blocks, non-editable game reference badges
	 * - Exports ReaderContent on every change via callback
	 */
	import { onMount, onDestroy } from 'svelte';
	import { Composer, ContentEditable, RichTextPlugin } from 'svelte-lexical';
	import {
		GameRefParagraphNode,
		setEditorMode,
	} from './nodes/GameRefParagraphNode.js';
	import { HeadingNode, initializeContent, exportContent } from './content.js';
	import type { ReaderContent } from '@pubwiki/api';

	interface Props {
		/** Initial content to populate editor */
		content: ReaderContent;
		/** Called when editor content changes */
		onContentChange?: (content: ReaderContent) => void;
		/** Additional CSS class */
		class?: string;
	}

	let { content = [], onContentChange, class: className = '' }: Props = $props();

	let composer: Composer | undefined = $state();
	let unregisterListener: (() => void) | null = null;

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

	const initialConfig = {
		namespace: 'Editor',
		theme,
		nodes: [HeadingNode, GameRefParagraphNode],
		onError: (error: Error) => {
			console.error('Editor error:', error);
		},
		editable: true,
	};

	onMount(() => {
		// Set editor mode so GameRefParagraphNode renders badge instead of play button
		setEditorMode(true);

		if (composer) {
			const editor = composer.getEditor();

			// Initialize content
			if (Array.isArray(content) && content.length > 0) {
				editor.update(
					() => initializeContent(content),
					{ discrete: true }
				);
			}

			// Listen for content changes
			let debounceTimer: ReturnType<typeof setTimeout> | null = null;
			unregisterListener = editor.registerUpdateListener(({ editorState }) => {
				if (!onContentChange) return;
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					editorState.read(() => {
							onContentChange(exportContent());
					});
				}, 300);
			});
		}
	});

	onDestroy(() => {
		unregisterListener?.();
		setEditorMode(false);
	});
</script>

<div class="editor {className}">
	<Composer {initialConfig} bind:this={composer}>
		<div class="editor-inner">
			<ContentEditable />
			<RichTextPlugin />
		</div>
	</Composer>
</div>

<style>
	.editor {
		position: relative;
		width: 100%;
		font-family: var(
			--reader-font-family,
			'Noto Serif SC',
			'Source Han Serif CN',
			'Songti SC',
			Georgia,
			'Times New Roman',
			serif
		);
	}

	.editor-inner {
		outline: none;
	}

	.editor :global([contenteditable]) {
		outline: none;
		min-height: 200px;
		padding: 0.5rem;
		border: 1px solid var(--reader-border-color, #e0e7ef);
		border-radius: 0.375rem;
	}

	.editor :global([contenteditable]:focus) {
		border-color: #3b82f6;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
	}

	/* Reuse Reader typography */
	.editor :global(.reader-paragraph) {
		position: relative;
		margin: 0 0 1em 0;
		font-size: var(--reader-font-size, 1rem);
		line-height: 1.8;
		color: var(--reader-text-color, #333);
	}

	.editor :global(.reader-paragraph:empty::before) {
		content: attr(data-placeholder);
		color: #999;
		pointer-events: none;
	}

	.editor :global(.reader-h1) {
		font-size: calc(var(--reader-font-size, 1rem) * 1.55);
		font-weight: 700;
		color: var(--reader-heading-color, #1a1a1a);
		margin: 1.5rem 0 1rem 0;
		line-height: 1.4;
	}

	.editor :global(.reader-h2) {
		font-size: calc(var(--reader-font-size, 1rem) * 1.22);
		font-weight: 600;
		color: var(--reader-heading-color, #2a2a2a);
		margin: 1.25rem 0 0.75rem 0;
		line-height: 1.5;
		padding-left: 0.75rem;
		border-left: 3px solid #0969da;
	}

	.editor :global(.reader-h3) {
		font-size: var(--reader-font-size, 1rem);
		font-weight: 600;
		color: var(--reader-heading-color, #3a3a3a);
		margin: 1rem 0 0.5rem 0;
		line-height: 1.5;
	}

	/* Game ref paragraph in editor mode */
	.editor :global(.game-ref-paragraph) {
		position: relative;
		padding-top: 0.5rem;
		padding-left: 0.75rem;
		border-left: 3px solid #10b981;
		background-color: rgba(16, 185, 129, 0.04);
	}

	/* Save badge */
	.editor :global(.game-ref-badge) {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		padding: 0.125rem 0.5rem;
		margin-bottom: 0.25rem;
		border-radius: 0.25rem;
		background-color: rgba(16, 185, 129, 0.1);
		color: #059669;
		font-size: 0.75rem;
		font-family: system-ui, sans-serif;
		user-select: none;
	}

	.editor :global(.game-ref-badge svg) {
		width: 12px;
		height: 12px;
	}
</style>
