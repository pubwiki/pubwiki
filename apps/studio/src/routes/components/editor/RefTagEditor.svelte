<script lang="ts">
	/**
	 * RefTagEditor - Rich text editor with reftag support
	 * 
	 * Uses Lexical with svelte-lexical bindings for a robust editing experience.
	 * Features:
	 * - @ triggered reftag insertion via menu
	 * - Reftags as atomic non-editable elements
	 * - Bidirectional conversion with ContentBlock[]
	 */
	import { onMount } from 'svelte';
	import {
		Composer,
		ContentEditable,
		RichTextPlugin,
		HistoryPlugin,
	} from 'svelte-lexical';
	import {
		$getRoot as getRoot,
		$createParagraphNode as createParagraphNode,
		$createTextNode as createTextNode,
		$isTextNode as isTextNode,
		$isParagraphNode as isParagraphNode,
		type EditorState,
		type LexicalEditor,
	} from 'lexical';
	import { RefTagNode, $createRefTagNode as createRefTagNode, $isRefTagNode as isRefTagNode } from './RefTagNode';
	import RefTagPlugin from './RefTagPlugin.svelte';
	import type { ContentBlock } from './content-block';

	interface Props {
		/** Structured content blocks */
		value: ContentBlock[];
		/** Read-only mode */
		readonly?: boolean;
		/** Placeholder text */
		placeholder?: string;
		/** Additional CSS class */
		class?: string;
		/** Available reftag suggestions */
		suggestions?: string[];
		/** Auto height mode - no max height, grows with content */
		autoHeight?: boolean;
		/** Change callback */
		onchange?: (blocks: ContentBlock[]) => void;
		/** Focus callback */
		onfocus?: () => void;
		/** Blur callback */
		onblur?: () => void;
	}

	let {
		value = [],
		readonly = false,
		placeholder = '',
		class: className = '',
		suggestions = [],
		autoHeight = false,
		onchange,
		onfocus,
		onblur,
	}: Props = $props();

	let composer: Composer | undefined = $state();
	let editorRef: LexicalEditor | null = null;
	let containerRef: HTMLDivElement | undefined = $state();
	let isInternalChange = false;
	let isInitialized = false;
	let isFocused = false;

	// Initial editor configuration - use a getter to always get current readonly value
	const initialConfig = {
		namespace: 'RefTagEditor',
		theme: {
			paragraph: 'editor-paragraph',
			text: {
				base: 'editor-text',
			},
		},
		nodes: [RefTagNode],
		onError: (error: Error) => {
			throw error;
		},
		editable: true, // Will be updated via $effect when readonly changes
	};

	// Initialize editor after mount
	onMount(() => {
		if (composer) {
			const editor = composer.getEditor();
			editorRef = editor;

			// Set initial readonly state
			editor.setEditable(!readonly);

			// Initialize content
			if (value.length > 0) {
				initializeFromBlocks(editor, value);
			}

			// Register change listener
			const unsubscribe = editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
				// Skip if this was an internal programmatic change
				if (isInternalChange) return;

				// Skip if nothing changed
				if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;

				const blocks = exportToBlocks(editorState);
				onchange?.(blocks);
			});

			isInitialized = true;

			return () => {
				unsubscribe();
			};
		}
	});

	/**
	 * Convert ContentBlock[] to Lexical EditorState
	 */
	function initializeFromBlocks(editor: LexicalEditor, blocks: ContentBlock[]) {
		editor.update(() => {
			const root = getRoot();
			root.clear();

			// Build paragraphs from blocks, splitting on newlines
			let currentParagraph = createParagraphNode();
			let hasContent = false;

			for (const block of blocks) {
				if (block.type === 'text') {
					const lines = block.value.split('\n');
					lines.forEach((line, index) => {
						if (line) {
							currentParagraph.append(createTextNode(line));
							hasContent = true;
						}
						if (index < lines.length - 1) {
							// Newline - finish current paragraph and start new one
							root.append(currentParagraph);
							currentParagraph = createParagraphNode();
							hasContent = false;
						}
					});
				} else if (block.type === 'reftag') {
					currentParagraph.append(createRefTagNode(block.name));
					hasContent = true;
				}
			}

			// Append the last paragraph
			root.append(currentParagraph);
		}, { discrete: true });
	}

	/**
	 * Convert Lexical EditorState to ContentBlock[]
	 */
	function exportToBlocks(editorState: EditorState): ContentBlock[] {
		const blocks: ContentBlock[] = [];

		editorState.read(() => {
			const root = getRoot();
			const paragraphs = root.getChildren();

			paragraphs.forEach((paragraph, paragraphIndex) => {
				if (!isParagraphNode(paragraph)) return;

				// Add newline between paragraphs (not before first)
				if (paragraphIndex > 0) {
					const last = blocks[blocks.length - 1];
					if (last?.type === 'text') {
						last.value += '\n';
					} else {
						blocks.push({ type: 'text', value: '\n' });
					}
				}

				// Process children of this paragraph
				const children = paragraph.getChildren();
				for (const node of children) {
					if (isRefTagNode(node)) {
						blocks.push({ type: 'reftag', name: node.getRefName() });
					} else if (isTextNode(node)) {
						const text = node.getTextContent();
						if (text) {
							const last = blocks[blocks.length - 1];
							if (last?.type === 'text') {
								last.value += text;
							} else {
								blocks.push({ type: 'text', value: text });
							}
						}
					}
				}
			});
		});

		return blocks;
	}

	// Sync external value changes to editor
	// Skip when focused - the focused editor is the source of truth
	$effect(() => {
		if (editorRef && value && !isFocused) {
			const currentText = blocksToString(exportToBlocks(editorRef.getEditorState()));
			const newText = blocksToString(value);

			if (currentText !== newText) {
				isInternalChange = true;
				withPreservedSelection(() => initializeFromBlocks(editorRef!, value));
				isInternalChange = false;
			}
		}
	});

	// Update editable state when readonly changes
	$effect(() => {
		if (editorRef) {
			editorRef.setEditable(!readonly);
		}
	});

	// Helper to compare blocks
	function blocksToString(blocks: ContentBlock[]): string {
		return blocks.map(b => b.type === 'text' ? b.value : `@${b.name}`).join('');
	}

	// Helper to run code without disrupting global selection
	function withPreservedSelection(fn: () => void) {
		const sel = window.getSelection();
		const savedRange = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
		const activeEl = document.activeElement as HTMLElement | null;
		
		fn();
		
		if (savedRange && activeEl && activeEl !== document.body) {
			activeEl.focus?.();
			sel?.removeAllRanges();
			sel?.addRange(savedRange);
		}
	}

	function handleFocus() {
		isFocused = true;
		onfocus?.();
	}

	function handleBlur() {
		isFocused = false;
		onblur?.();
	}
</script>

<div
	bind:this={containerRef}
	class="reftag-editor nodrag nowheel {className}"
	class:readonly
	class:auto-height={autoHeight}
	role="textbox"
	aria-multiline="true"
	onfocusin={handleFocus}
	onfocusout={handleBlur}
>
	<Composer {initialConfig} bind:this={composer}>
		<div class="editor-inner">
			<div class="editor-scroller">
				<div class="editor">
					<ContentEditable />
					{#if placeholder && value.length === 0}
						<div class="editor-placeholder">{placeholder}</div>
					{/if}
				</div>
			</div>
			<RichTextPlugin />
			<HistoryPlugin />
			{#if !readonly}
				<RefTagPlugin {suggestions} />
			{/if}
		</div>
	</Composer>
</div>

<style>
	.reftag-editor {
		position: relative;
		width: 100%;
		max-height: 12rem;
		overflow-y: auto;
		background: transparent;
		cursor: text;
	}

	.reftag-editor.auto-height {
		max-height: none;
		overflow-y: visible;
	}

	.reftag-editor.readonly {
		cursor: default;
	}

	.editor-inner {
		position: relative;
	}

	.editor-scroller {
		padding: 0.1rem 0.2rem;
		outline: none;
		font-size: 0.875rem;
		line-height: 1.5;
		color: #374151;
		white-space: pre-wrap;
		word-wrap: break-word;
	}

	.editor-scroller :global([contenteditable]) {
		outline: none;
	}

	.reftag-editor :global(.editor-paragraph) {
		margin: 0;
	}

	/* RefTag node styling */
	.reftag-editor :global(.reftag-node) {
		background-color: rgba(88, 166, 255, 0.2);
		border-radius: 4px;
		padding: 1px 4px;
		cursor: default;
		user-select: all;
		color: #3b82f6;
		font-weight: 500;
	}

	.reftag-editor :global(.reftag-node:focus),
	.reftag-editor :global(.reftag-node::selection) {
		box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.4);
		outline: none;
	}

	.editor-placeholder {
		position: absolute;
		top: 0.75rem;
		left: 0.75rem;
		color: #9ca3af;
		pointer-events: none;
		user-select: none;
		font-size: 0.875rem;
	}

	.readonly .editor-placeholder {
		display: none;
	}
</style>
