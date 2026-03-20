<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';

	interface Props {
		/** Total number of items (including unloaded) */
		totalItems: number;
		/** Height of each item in pixels */
		itemHeight: number;
		/** Gap between items in pixels */
		gap?: number;
		/** Number of buffer rows above/below visible area */
		bufferRows?: number;
		/** Current column count (responsive) */
		columnCount: number;
		/** Page size for data loading */
		pageSize: number;
		/** Get items for a range (may include nulls for loading state) */
		getItems: (startIdx: number, endIdx: number) => (T | null)[];
		/** Called when visible page range changes */
		onPageRangeChange?: (startPage: number, endPage: number) => void;
		/** Called when current page changes (for URL persistence) */
		onCurrentPageChange?: (page: number) => void;
		/** Render snippet for each item */
		children: Snippet<[item: T, index: number]>;
		/** Render snippet for loading placeholder */
		placeholder?: Snippet<[index: number]>;
		/** Initial scroll to page */
		initialPage?: number;
	}

	let {
		totalItems,
		itemHeight,
		gap = 20,
		bufferRows = 2,
		columnCount,
		pageSize,
		getItems,
		onPageRangeChange,
		onCurrentPageChange,
		children,
		placeholder,
		initialPage = 1
	}: Props = $props();

	let containerEl: HTMLElement | null = $state(null);
	let scrollTop = $state(0);
	let viewportHeight = $state(browser ? window.innerHeight : 800);
	let containerOffsetTop = $state(0);
	let hasInitialScrolled = $state(false);

	const rowHeight = $derived(itemHeight + gap);
	const totalRows = $derived(Math.ceil(totalItems / columnCount));
	const totalHeight = $derived(totalRows * rowHeight);

	// Relative scroll position within the virtual grid
	const relativeScrollTop = $derived(Math.max(0, scrollTop - containerOffsetTop));

	// Calculate visible row range based on relative scroll position
	const visibleRange = $derived.by(() => {
		if (viewportHeight === 0) {
			return { startRow: 0, endRow: 0, startIndex: 0, endIndex: 0 };
		}
		
		const startRow = Math.floor(relativeScrollTop / rowHeight);
		const visibleRows = Math.ceil(viewportHeight / rowHeight);
		
		const bufferedStartRow = Math.max(0, startRow - bufferRows);
		const bufferedEndRow = Math.min(totalRows, startRow + visibleRows + bufferRows);
		
		return {
			startRow: bufferedStartRow,
			endRow: bufferedEndRow,
			startIndex: bufferedStartRow * columnCount,
			endIndex: Math.min(totalItems, bufferedEndRow * columnCount)
		};
	});

	// Calculate current page based on scroll position (first visible item's page)
	const currentPage = $derived.by(() => {
		if (totalItems === 0) return 1;
		// Use the first visible row's first item to determine current page
		const firstVisibleRow = Math.floor(relativeScrollTop / rowHeight);
		const firstVisibleIndex = firstVisibleRow * columnCount;
		// Clamp to valid range
		const clampedIndex = Math.max(0, Math.min(firstVisibleIndex, totalItems - 1));
		return Math.floor(clampedIndex / pageSize) + 1;
	});

	// Get items for visible range
	const visibleItems = $derived.by(() => {
		if (visibleRange.startIndex >= visibleRange.endIndex) {
			return [];
		}
		return getItems(visibleRange.startIndex, visibleRange.endIndex);
	});

	// Padding calculations
	const topPadding = $derived(visibleRange.startRow * rowHeight);
	const _bottomPadding = $derived(Math.max(0, (totalRows - visibleRange.endRow) * rowHeight));

	// Setup window scroll and resize listeners
	$effect(() => {
		if (!browser) return;
		
		const handleScroll = () => {
			scrollTop = window.scrollY;
		};
		
		const handleResize = () => {
			viewportHeight = window.innerHeight;
		};
		
		// Initial values
		scrollTop = window.scrollY;
		viewportHeight = window.innerHeight;
		
		window.addEventListener('scroll', handleScroll, { passive: true });
		window.addEventListener('resize', handleResize, { passive: true });
		
		return () => {
			window.removeEventListener('scroll', handleScroll);
			window.removeEventListener('resize', handleResize);
		};
	});

	// Update container offset when mounted or resized
	$effect(() => {
		if (!containerEl) return;
		
		const updateOffset = () => {
			const rect = containerEl!.getBoundingClientRect();
			containerOffsetTop = rect.top + window.scrollY;
		};
		
		updateOffset();
		
		// Use ResizeObserver to detect layout changes
		const observer = new ResizeObserver(updateOffset);
		observer.observe(containerEl);
		
		return () => observer.disconnect();
	});

	// Notify parent of page range changes
	$effect(() => {
		if (totalItems === 0) return;
		
		const startPage = Math.floor(visibleRange.startIndex / pageSize) + 1;
		const endPage = Math.max(1, Math.ceil(visibleRange.endIndex / pageSize));
		
		// Use untrack to prevent tracking any state changes in the callback
		untrack(() => {
			onPageRangeChange?.(startPage, endPage);
		});
	});

	// Notify parent of current page changes (debounced for URL updates)
	let pageUpdateTimeout: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const page = currentPage;
		
		if (pageUpdateTimeout) {
			clearTimeout(pageUpdateTimeout);
		}
		
		pageUpdateTimeout = setTimeout(() => {
			untrack(() => {
				onCurrentPageChange?.(page);
			});
		}, 150);
		
		return () => {
			if (pageUpdateTimeout) {
				clearTimeout(pageUpdateTimeout);
			}
		};
	});

	// Initial scroll to page
	$effect(() => {
		if (!browser || hasInitialScrolled || !containerEl || totalItems === 0 || initialPage <= 1) {
			return;
		}
		
		// Calculate scroll position for initial page
		const startIndex = (initialPage - 1) * pageSize;
		const targetRow = Math.floor(startIndex / columnCount);
		const targetScrollTop = containerOffsetTop + targetRow * rowHeight;
		
		untrack(() => {
			window.scrollTo({ top: targetScrollTop, behavior: 'instant' });
			hasInitialScrolled = true;
		});
	});

	// Group items into rows for grid layout
	const rows = $derived.by(() => {
		const result: { items: (T | null)[]; startIndex: number }[] = [];
		
		for (let i = 0; i < visibleItems.length; i += columnCount) {
			result.push({
				items: visibleItems.slice(i, i + columnCount),
				startIndex: visibleRange.startIndex + i
			});
		}
		
		return result;
	});
</script>

<div
	bind:this={containerEl}
	class="virtual-grid-container"
	style="min-height: {totalHeight}px; position: relative;"
>
	<div style="transform: translateY({topPadding}px);">
		{#each rows as row, rowIdx (visibleRange.startRow + rowIdx)}
			<div 
				class="grid gap-5" 
				style="grid-template-columns: repeat({columnCount}, minmax(0, 1fr)); margin-bottom: {gap}px;"
			>
				{#each row.items as item, colIdx (row.startIndex + colIdx)}
					{#if item !== null}
						{@render children(item, row.startIndex + colIdx)}
					{:else if placeholder}
						{@render placeholder(row.startIndex + colIdx)}
					{:else}
						<!-- Default loading placeholder -->
						<div 
							class="bg-gray-100 rounded-xl animate-pulse"
							style="height: {itemHeight}px;"
						></div>
					{/if}
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	/* No special styles needed for window-based scrolling */
</style>
