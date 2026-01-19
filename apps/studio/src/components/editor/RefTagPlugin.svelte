<script lang="ts">
	/**
	 * RefTagPlugin - Lexical plugin for @ mention-style reftag input
	 * 
	 * Features:
	 * - Detects @ trigger character
	 * - Shows suggestion menu
	 * - Inserts RefTagNode on selection
	 */
	import { onMount } from 'svelte';
	import { mergeRegister } from '@lexical/utils';
	import {
		$getSelection as getSelection,
		$isRangeSelection as isRangeSelection,
		$createTextNode as createTextNode,
		COMMAND_PRIORITY_LOW,
		KEY_ENTER_COMMAND,
		KEY_ESCAPE_COMMAND,
		KEY_ARROW_DOWN_COMMAND,
		KEY_ARROW_UP_COMMAND,
		KEY_BACKSPACE_COMMAND,
		KEY_TAB_COMMAND,
		TextNode,
		type LexicalEditor,
	} from 'lexical';
	import { $createRefTagNode as createRefTagNode, RefTagNode } from './RefTagNode';
	import { getEditor } from 'svelte-lexical';

	interface Props {
		/** Available suggestions for autocomplete */
		suggestions?: string[];
	}

	let { suggestions = [] }: Props = $props();

	// Get editor from context (set by svelte-lexical Composer)
	const editor = getEditor();

	// State
	let menuOpen = $state(false);
	let menuPosition = $state({ x: 0, y: 0 });
	let searchText = $state('');
	let selectedIndex = $state(0);
	let triggerMatch: { start: number; end: number } | null = null;
	let menuRef: HTMLDivElement | undefined = $state();

	// Portal action: move element to document.body to escape Svelte Flow's transform
	function portal(node: HTMLElement) {
		const target = document.body;
		target.appendChild(node);
		return {
			destroy() {
				if (node.parentNode === target) {
					target.removeChild(node);
				}
			}
		};
	}

	// Verify RefTagNode is registered
	if (!editor.hasNodes([RefTagNode])) {
		throw new Error('RefTagPlugin: RefTagNode not registered on editor');
	}

	// Filter suggestions based on search text
	const filteredSuggestions = $derived(
		suggestions.filter(s =>
			s.toLowerCase().includes(searchText.toLowerCase())
		)
	);

	// Check if we can create a new tag
	// Allow when: empty (show prompt) OR valid identifier not in suggestions
	const canCreateNew = $derived(
		searchText.length === 0 || (
			/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(searchText) &&
			!suggestions.some(s => s.toLowerCase() === searchText.toLowerCase())
		)
	);

	onMount(() => {
		console.log('[RefTagPlugin] Mounted, registering listeners');
		return mergeRegister(
			// Monitor text changes to detect @ trigger
			editor.registerUpdateListener(({ editorState }) => {
				editorState.read(() => {
					const selection = getSelection();
					console.log('[RefTagPlugin] Update listener triggered, selection:', selection, 'menuOpen:', menuOpen);
					if (!isRangeSelection(selection) || !selection.isCollapsed()) {
						// Don't close menu on transient null selection (e.g., during re-render)
						// Only close if menu is not already open with a valid trigger
						if (!menuOpen || !triggerMatch) {
							closeMenu();
						}
						return;
					}

					const anchor = selection.anchor;
					const node = anchor.getNode();
					console.log('[RefTagPlugin] Node type:', node.getType(), 'isTextNode:', node instanceof TextNode);

					if (!(node instanceof TextNode)) {
						closeMenu();
						return;
					}

					const text = node.getTextContent();
					const offset = anchor.offset;
					console.log('[RefTagPlugin] Text:', JSON.stringify(text), 'offset:', offset);

					// Find @ trigger character
					const atIndex = text.lastIndexOf('@', offset - 1);
					console.log('[RefTagPlugin] atIndex:', atIndex);
					if (atIndex === -1) {
						closeMenu();
						return;
					}

					// Only trigger when cursor is at end of word (no non-whitespace after cursor)
					const textAfterCursor = text.slice(offset);
					const cursorAtWordEnd = textAfterCursor.length === 0 || /^\s/.test(textAfterCursor);
					if (!cursorAtWordEnd) {
						closeMenu();
						return;
					}

					// Extract query text after @
					const query = text.slice(atIndex + 1, offset);
					console.log('[RefTagPlugin] query:', JSON.stringify(query));

					// Validate query format (only allow valid identifier characters)
					if (query && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(query) && !/^[a-zA-Z_]?$/.test(query)) {
						console.log('[RefTagPlugin] Closing menu: invalid query format');
						closeMenu();
						return;
					}

					console.log('[RefTagPlugin] Opening menu with query:', query);
					triggerMatch = { start: atIndex, end: offset };
					searchText = query;
					selectedIndex = 0;
					openMenuAtCursor();
				});
			}),

			// Handle Enter to confirm selection
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(e) => {
					if (menuOpen) {
						e?.preventDefault();
						if (filteredSuggestions.length > 0) {
							selectSuggestion(filteredSuggestions[selectedIndex]);
						} else if (canCreateNew) {
							selectSuggestion(searchText);
						}
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_LOW
			),

			// Handle Tab to confirm selection (same as Enter)
			editor.registerCommand(
				KEY_TAB_COMMAND,
				(e) => {
					if (menuOpen) {
						e?.preventDefault();
						if (filteredSuggestions.length > 0) {
							selectSuggestion(filteredSuggestions[selectedIndex]);
						} else if (canCreateNew) {
							selectSuggestion(searchText);
						}
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_LOW
			),

			// Handle Escape to close menu
			editor.registerCommand(
				KEY_ESCAPE_COMMAND,
				() => {
					if (menuOpen) {
						closeMenu();
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_LOW
			),

			// Handle arrow down for menu navigation
			editor.registerCommand(
				KEY_ARROW_DOWN_COMMAND,
				(e) => {
					if (menuOpen) {
						e?.preventDefault();
						const maxIndex = canCreateNew 
							? filteredSuggestions.length 
							: filteredSuggestions.length - 1;
						selectedIndex = Math.min(selectedIndex + 1, maxIndex);
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_LOW
			),

			// Handle arrow up for menu navigation
			editor.registerCommand(
				KEY_ARROW_UP_COMMAND,
				(e) => {
					if (menuOpen) {
						e?.preventDefault();
						selectedIndex = Math.max(selectedIndex - 1, 0);
						return true;
					}
					return false;
				},
				COMMAND_PRIORITY_LOW
			),
		);
	});

	function openMenuAtCursor() {
		const nativeSelection = window.getSelection();
		if (!nativeSelection?.rangeCount) return;

		const range = nativeSelection.getRangeAt(0);
		
		// 创建一个临时 span 元素来获取精确的光标位置
		// 这比直接使用 range.getBoundingClientRect() 更准确
		// 尤其是当编辑器在 transform/translate 的容器中时
		let rect: DOMRect;
		
		// 尝试使用 range 的 client rects，获取更精确的光标位置
		const rects = range.getClientRects();
		if (rects.length > 0) {
			// 使用最后一个 rect（光标实际位置）
			rect = rects[rects.length - 1];
		} else {
			// fallback 到 getBoundingClientRect
			rect = range.getBoundingClientRect();
		}

		// 如果 rect 的位置是 0,0，可能是因为 range 为空
		// 尝试从选区的 anchor 节点获取位置
		if (rect.left === 0 && rect.top === 0 && range.startContainer) {
			const tempSpan = document.createElement('span');
			tempSpan.textContent = '\u200B'; // 零宽空格
			range.insertNode(tempSpan);
			rect = tempSpan.getBoundingClientRect();
			tempSpan.parentNode?.removeChild(tempSpan);
			// 重新规范化 selection
			nativeSelection.removeAllRanges();
			nativeSelection.addRange(range);
		}

		// 使用视口坐标（getBoundingClientRect 已经返回视口坐标）
		// position: fixed 的元素直接使用这些坐标即可
		menuPosition = { 
			x: rect.left, 
			y: rect.bottom + 4 
		};
		
		console.log('[RefTagPlugin] Menu position:', menuPosition, 'rect:', rect);
		menuOpen = true;
	}

	function closeMenu() {
		menuOpen = false;
		triggerMatch = null;
		searchText = '';
	}

	function selectSuggestion(refName: string) {
		if (!triggerMatch) return;

		editor.update(() => {
			const selection = getSelection();
			if (!isRangeSelection(selection)) return;

			const anchor = selection.anchor;
			const node = anchor.getNode();

			if (!(node instanceof TextNode)) return;

			const text = node.getTextContent();
			const { start, end } = triggerMatch!;

			// Text before @ trigger
			const beforeText = text.slice(0, start);
			// Text after the current cursor position
			const afterText = text.slice(end);

			// Create the RefTagNode
			const refTagNode = createRefTagNode(refName);

			// Split and rebuild
			if (beforeText) {
				const beforeNode = createTextNode(beforeText);
				node.insertBefore(beforeNode);
			}

			node.insertBefore(refTagNode);

			// Update the current node with remaining text or remove it
			if (afterText) {
				node.setTextContent(afterText);
			} else {
				// Add a space after reftag to allow continued typing
				const spaceNode = createTextNode(' ');
				node.replace(spaceNode);
				spaceNode.select();
			}

			// Move cursor after the reftag
			refTagNode.selectNext();
		});

		closeMenu();
	}

	function handleMenuItemClick(suggestion: string) {
		selectSuggestion(suggestion);
	}
</script>

{#if menuOpen && (filteredSuggestions.length > 0 || canCreateNew)}
	<div
		bind:this={menuRef}
		use:portal
		class="reftag-menu"
		style="left: {menuPosition.x}px; top: {menuPosition.y}px;"
	>
		{#if filteredSuggestions.length > 0}
			<ul>
				{#each filteredSuggestions as suggestion, i}
					<li
						class:selected={i === selectedIndex}
						onclick={() => handleMenuItemClick(suggestion)}
						onkeydown={(e) => e.key === 'Enter' && handleMenuItemClick(suggestion)}
						role="option"
						aria-selected={i === selectedIndex}
						tabindex="-1"
					>
						<span class="suggestion-text">@{suggestion}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if canCreateNew}
			<button
				class="create-new"
				class:selected={selectedIndex === filteredSuggestions.length}
				onclick={() => searchText && handleMenuItemClick(searchText)}
				disabled={!searchText}
			>
				{#if searchText}
					<span class="plus-icon">+</span>
					<span>新建 @{searchText}</span>
				{:else}
					<span class="hint-text">输入名称创建引用...</span>
				{/if}
			</button>
		{/if}
	</div>
{/if}

<style>
	.reftag-menu {
		position: fixed;
		background: white;
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		max-height: 200px;
		min-width: 150px;
		overflow-y: auto;
		z-index: 100;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 4px;
	}

	li {
		padding: 8px 12px;
		cursor: pointer;
		border-radius: 4px;
		display: flex;
		align-items: center;
	}

	li.selected {
		background: #e2e8f0;
	}

	li:hover {
		background: #f1f5f9;
	}

	.suggestion-text {
		color: #374151;
	}

	.create-new {
		width: 100%;
		padding: 8px 12px;
		border: none;
		border-top: 1px solid #e2e8f0;
		background: none;
		cursor: pointer;
		text-align: left;
		display: flex;
		align-items: center;
		gap: 8px;
		color: #3b82f6;
	}

	.create-new.selected {
		background: #e2e8f0;
	}

	.create-new:hover {
		background: #f1f5f9;
	}

	.create-new:disabled {
		cursor: default;
		color: #9ca3af;
	}

	.create-new:disabled:hover {
		background: none;
	}

	.plus-icon {
		font-weight: bold;
	}

	.hint-text {
		color: #9ca3af;
		font-style: italic;
	}
</style>
