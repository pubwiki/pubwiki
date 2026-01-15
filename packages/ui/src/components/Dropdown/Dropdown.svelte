<script lang="ts" generics="T = string">
	/**
	 * Dropdown - A simple dropdown select component
	 * 
	 * Features:
	 * - Clean, styled dropdown with chevron icon
	 * - Click outside to close
	 * - Keyboard navigation support
	 * - Customizable placeholder and disabled state
	 * - Size variants (sm, md)
	 */
	import { onMount } from 'svelte';

	export interface DropdownProps<T> {
		/** Array of items to display */
		items: T[];
		/** Currently selected value */
		value?: T;
		/** Placeholder text when no value selected */
		placeholder?: string;
		/** Whether the dropdown is disabled */
		disabled?: boolean;
		/** Size variant */
		size?: 'sm' | 'md';
		/** Function to get display label from item */
		getLabel?: (item: T) => string;
		/** Function to get unique key from item */
		getKey?: (item: T) => string;
		/** Callback when selection changes */
		onchange?: (value: T) => void;
		/** Custom class for the container */
		class?: string;
	}

	let {
		items,
		value = $bindable(),
		placeholder = 'Select...',
		disabled = false,
		size = 'md',
		getLabel = (item) => String(item),
		getKey = (item) => String(item),
		onchange,
		class: className = ''
	}: DropdownProps<T> = $props();

	let isOpen = $state(false);
	let containerRef: HTMLDivElement;
	let highlightedIndex = $state(-1);

	// Size-based styles
	const sizeStyles = {
		sm: {
			button: 'px-2 py-1.5 text-xs',
			icon: 'w-3.5 h-3.5',
			item: 'px-2 py-1.5 text-xs'
		},
		md: {
			button: 'px-3 py-2 text-sm',
			icon: 'w-5 h-5',
			item: 'px-3 py-2 text-sm'
		}
	};
	
	let currentSize = $derived(sizeStyles[size]);

	// Get display text for current value
	let displayText = $derived(value !== undefined ? getLabel(value) : placeholder);
	let hasValue = $derived(value !== undefined);

	function toggle() {
		if (!disabled) {
			isOpen = !isOpen;
			if (isOpen) {
				// Reset highlighted index to current selection
				highlightedIndex = value !== undefined ? items.findIndex(item => getKey(item) === getKey(value!)) : -1;
			}
		}
	}

	function select(item: typeof items[number]) {
		value = item;
		isOpen = false;
		onchange?.(item);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (!isOpen) {
			if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
				e.preventDefault();
				isOpen = true;
				highlightedIndex = value !== undefined ? items.findIndex(item => getKey(item) === getKey(value!)) : 0;
			}
			return;
		}

		switch (e.key) {
			case 'Escape':
				e.preventDefault();
				isOpen = false;
				break;
			case 'ArrowDown':
				e.preventDefault();
				highlightedIndex = Math.min(highlightedIndex + 1, items.length - 1);
				break;
			case 'ArrowUp':
				e.preventDefault();
				highlightedIndex = Math.max(highlightedIndex - 1, 0);
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				if (highlightedIndex >= 0 && highlightedIndex < items.length) {
					select(items[highlightedIndex]);
				}
				break;
		}
	}

	function handleClickOutside(e: MouseEvent) {
		if (isOpen && containerRef && !containerRef.contains(e.target as Node)) {
			isOpen = false;
		}
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});
</script>

<div class="relative {className}" bind:this={containerRef}>
	<!-- Trigger button -->
	<button
		type="button"
		onclick={toggle}
		onkeydown={handleKeydown}
		{disabled}
		class="w-full {currentSize.button} border border-gray-300 rounded-lg bg-white text-left flex items-center justify-between
			focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
			disabled:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400
			transition-colors"
	>
		<span class={hasValue ? 'text-gray-900' : 'text-gray-400'}>
			{displayText}
		</span>
		<svg 
			class="{currentSize.icon} text-gray-400 transition-transform {isOpen ? 'rotate-180' : ''}" 
			fill="none" 
			stroke="currentColor" 
			viewBox="0 0 24 24"
		>
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
		</svg>
	</button>

	<!-- Dropdown panel -->
	{#if isOpen && items.length > 0}
		<div class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
			<div class="max-h-60 overflow-y-auto">
				{#each items as item, index}
					{@const isSelected = value !== undefined && getKey(item) === getKey(value)}
					{@const isHighlighted = index === highlightedIndex}
					<button
						type="button"
						class="w-full {currentSize.item} text-left hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-b-0
							{isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}
							{isHighlighted && !isSelected ? 'bg-gray-50' : ''}"
						onclick={() => select(item)}
						onmouseenter={() => highlightedIndex = index}
					>
						{getLabel(item)}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
