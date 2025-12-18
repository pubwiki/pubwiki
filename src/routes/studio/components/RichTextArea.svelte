<script lang="ts">
	import { REFTAG_PATTERN } from "../utils/reftag";
	/**
	 * RichTextArea - Textarea with syntax highlighting using backdrop overlay
	 * 
	 * Architecture:
	 * - Transparent <textarea> in front for input
	 * - <div> backdrop behind showing highlighted text
	 * - Both share identical styling for perfect alignment
	 */

	interface Props {
		value: string;
		readonly?: boolean;
		placeholder?: string;
		class?: string;
		onchange?: (value: string) => void;
		onfocus?: () => void;
		onblur?: () => void;
	}

	let { 
		value = $bindable(''), 
		readonly = false, 
		placeholder = '',
		class: className = '',
		onchange,
		onfocus,
		onblur
	}: Props = $props();

	let textareaRef: HTMLTextAreaElement | undefined = $state();
	let backdropRef: HTMLDivElement | undefined = $state();

	// Generate highlighted HTML from text
	function highlightText(text: string): string {
		if (!text) return '';
		
		let result = '';
		let lastIndex = 0;
		
		REFTAG_PATTERN.lastIndex = 0;
		
		let match: RegExpExecArray | null;
		while ((match = REFTAG_PATTERN.exec(text)) !== null) {
			// Add text before reftag (escape HTML)
			if (match.index > lastIndex) {
				result += escapeHtml(text.slice(lastIndex, match.index));
			}
			// Add highlighted reftag
			result += `<span class="reftag-highlight">${escapeHtml(match[0])}</span>`;
			lastIndex = match.index + match[0].length;
		}
		
		// Add remaining text
		if (lastIndex < text.length) {
			result += escapeHtml(text.slice(lastIndex));
		}
		
		// Add a trailing space to match textarea behavior with trailing newline
		// This ensures the backdrop height matches the textarea
		if (text.endsWith('\n')) {
			result += ' ';
		}
		
		return result;
	}

	function escapeHtml(text: string): string {
		return text
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/\n/g, '<br>');
	}

	function handleInput(e: Event): void {
		const target = e.target as HTMLTextAreaElement;
		value = target.value;
		onchange?.(value);
	}

	function handleScroll(): void {
		if (textareaRef && backdropRef) {
			backdropRef.scrollTop = textareaRef.scrollTop;
			backdropRef.scrollLeft = textareaRef.scrollLeft;
		}
	}

	function handleWheel(e: WheelEvent): void {
		const target = e.currentTarget as HTMLElement;
		const { scrollTop, scrollHeight, clientHeight } = target;
		const isScrollable = scrollHeight > clientHeight;

		if (isScrollable) {
			const isAtTop = scrollTop === 0 && e.deltaY < 0;
			const isAtBottom = scrollTop + clientHeight >= scrollHeight && e.deltaY > 0;
			if (!isAtTop && !isAtBottom) {
				e.stopPropagation();
			}
		}
	}

	// Reactive highlighted content
	let highlightedHtml = $derived(highlightText(value));
</script>

<div class="rich-text-area nodrag nowheel {className}" onwheel={handleWheel}>
	<!-- Backdrop with highlighted text - determines height -->
	<div 
		bind:this={backdropRef}
		class="backdrop"
		aria-hidden="true"
	>{@html highlightedHtml}&nbsp;</div>
	
	<!-- Transparent textarea for input - overlays backdrop -->
	<textarea
		bind:this={textareaRef}
		bind:value
		{readonly}
		{placeholder}
		class="input"
		class:readonly
		spellcheck="false"
		oninput={handleInput}
		onscroll={handleScroll}
		onfocus={onfocus}
		onblur={onblur}
	></textarea>
</div>

<style>
	.rich-text-area {
		position: relative;
		width: 100%;
		min-height: 8rem;
		max-height: 12rem;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* Shared text styling for perfect alignment */
	.backdrop,
	.input {
		width: 100%;
		margin: 0;
		padding: 0.75rem;
		border: none;
		font-family: inherit;
		font-size: 0.875rem;
		line-height: 1.5;
		letter-spacing: normal;
		white-space: pre-wrap;
		word-wrap: break-word;
		word-break: break-all;
		box-sizing: border-box;
	}

	.backdrop {
		position: relative;
		color: #374151;
		pointer-events: none;
		z-index: 1;
		background: transparent;
		min-height: 8rem;
	}

	.input {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		color: transparent;
		caret-color: #3b82f6;
		background: transparent;
		outline: none;
		resize: none;
		z-index: 2;
		-webkit-text-fill-color: transparent;
		overflow: hidden;
	}

	.input::placeholder {
		color: #9ca3af;
		-webkit-text-fill-color: #9ca3af;
	}

	.input.readonly {
		cursor: default;
	}

	/* reftag highlight style - inline with no extra spacing */
	.backdrop :global(.reftag-highlight) {
		background-color: #e5e7eb;
		border-radius: 0.25rem;
		padding: 0.1em 0;
		margin: 0;
		box-decoration-break: clone;
		-webkit-box-decoration-break: clone;
	}
</style>
