<script lang="ts" generics="T = string">
	/**
	 * VirtualizedDropdown - A dropdown with virtual list and search
	 * 
	 * Features:
	 * - Virtual list for performance with large datasets
	 * - Search/filter functionality
	 * - Click outside to close
	 * - Keyboard navigation support
	 * - Customizable placeholder and disabled state
	 */
	import { VirtualList } from 'flowbite-svelte';
	import { onMount } from 'svelte';

	export interface VirtualizedDropdownProps<T> {
		/** Array of items to display */
		items: T[];
		/** Currently selected value */
		value?: T;
		/** Placeholder text when no value selected */
		placeholder?: string;
		/** Search input placeholder */
		searchPlaceholder?: string;
		/** Text to show when no items match search */
		noMatchText?: string;
		/** Whether the dropdown is disabled */
		disabled?: boolean;
		/** Function to get display label from item */
		getLabel?: (item: T) => string;
		/** Function to get unique key from item */
		getKey?: (item: T) => string;
		/** Function to check if item matches search query */
		matchesSearch?: (item: T, query: string) => boolean;
		/** Callback when selection changes */
		onchange?: (value: T) => void;
		/** Height of the virtual list in pixels */
		listHeight?: number;
		/** Minimum item height for virtual list */
		minItemHeight?: number;
		/** Size variant */
		size?: 'sm' | 'md';
		/** Custom class for the container */
		class?: string;
	}

	let {
		items,
		value = $bindable(),
		placeholder = 'Select...',
		searchPlaceholder = 'Search...',
		noMatchText = 'No matches found',
		disabled = false,
		getLabel = (item) => String(item),
		getKey = (item) => String(item),
		matchesSearch = (item, query) => getLabel(item).toLowerCase().includes(query.toLowerCase()),
		onchange,
		listHeight = 240,
		minItemHeight = 40,
		size = 'md',
		class: className = ''
	}: VirtualizedDropdownProps<T> = $props();

	// Size-based styles
	const sizeStyles = {
		sm: {
			button: 'px-2 py-1.5 text-xs',
			icon: 'w-3.5 h-3.5',
			input: 'px-2 py-1.5 text-xs',
			item: 'px-2 py-1.5 text-xs'
		},
		md: {
			button: 'px-3 py-2 text-sm',
			icon: 'w-5 h-5',
			input: 'px-3 py-2 text-sm',
			item: 'px-3 py-2 text-sm'
		}
	};
	let currentSize = $derived(sizeStyles[size]);

	let isOpen = $state(false);
	let searchQuery = $state('');
	let containerRef: HTMLDivElement;
	let searchInputRef = $state<HTMLInputElement | null>(null);

	// Filter items based on search
	let filteredItems = $derived(
		searchQuery
			? items.filter(item => matchesSearch(item, searchQuery))
			: items
	);

	// Get display text for current value
	let displayText = $derived(value !== undefined ? getLabel(value) : placeholder);
	let hasValue = $derived(value !== undefined);

	function toggle() {
		if (!disabled && items.length > 0) {
			isOpen = !isOpen;
			if (isOpen) {
				searchQuery = '';
				// Focus search input after opening
				setTimeout(() => searchInputRef?.focus(), 0);
			}
		}
	}

	function select(item: typeof items[number]) {
		value = item;
		isOpen = false;
		searchQuery = '';
		onchange?.(item);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			isOpen = false;
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
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div 
			class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
			onkeydown={handleKeydown}
		>
			<!-- Search input -->
			<div class="p-2 border-b border-gray-200">
				<input
					type="text"
					bind:this={searchInputRef}
					bind:value={searchQuery}
					placeholder={searchPlaceholder}
					class="w-full {currentSize.input} border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				/>
			</div>

			<!-- Virtual list for items -->
			<div class="max-h-60">
				{#if filteredItems.length > 0}
					<VirtualList items={filteredItems} {minItemHeight} height={listHeight}>
						{#snippet children(item: T, index: number)}
							{@const isSelected = value !== undefined && getKey(item) === getKey(value)}
							<button
								type="button"
								class="w-full {currentSize.item} text-left hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-b-0
									{isSelected ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}"
								onclick={() => select(item)}
							>
								{getLabel(item)}
							</button>
						{/snippet}
					</VirtualList>
				{:else}
					<div class="px-3 py-4 text-sm text-gray-500 text-center">
						{noMatchText}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
