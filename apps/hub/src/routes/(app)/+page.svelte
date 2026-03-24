<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { untrack, tick } from 'svelte';
	import { useArtifactStore } from '$lib/stores/artifacts.svelte';
	import { createSearchStore } from '$lib/stores/search.svelte';
	import { apiClient } from '$lib/api';
	import VirtualGrid from '$lib/components/VirtualGrid.svelte';
	import ArtifactCard from '$lib/components/ArtifactCard.svelte';
	import type { ArtifactListItem, ListTagsResponse } from '@pubwiki/api';
	import { Dropdown } from '@pubwiki/ui';
	import * as m from '$lib/paraglide/messages';

	const artifactStore = useArtifactStore();
	const searchStore = createSearchStore();

	// Search state - initialized from URL
	let searchInput = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	const DEBOUNCE_MS = 300;
	let isInitialLoad = $state(true);  // Track if this is initial page load

	// URL params for persistence (source of truth for both browse and search modes)
	const urlParams = $derived.by(() => {
		const params = $page.url.searchParams;
		const tagsParam = params.get('tags');
		return {
			page: parseInt(params.get('page') || '1'),
			sort: (params.get('sort') || 'createdAt') as 'createdAt' | 'viewCount' | 'favCount',
			order: (params.get('order') || 'desc') as 'asc' | 'desc',
			tags: tagsParam ? tagsParam.split(',').filter(Boolean) : [],
			q: params.get('q') || null  // Search query from URL
		};
	});
	
	// Initialize searchInput from URL on mount
	$effect(() => {
		if (!browser) return;
		const q = urlParams.q;
		const tagInclude = urlParams.tags.length > 0 ? urlParams.tags : undefined;
		
		// On initial load, sync from URL and trigger search immediately (no debounce)
		if (isInitialLoad && q !== null) {
			searchInput = q;
			untrack(() => {
				searchStore.search(q, { tagInclude });
				isInitialLoad = false;
			});
		} else if (isInitialLoad) {
			isInitialLoad = false;
		}
	});

	const sortMap: Record<string, 'New' | 'Top' | 'Trending'> = {
		createdAt: 'New',
		favCount: 'Top',
		viewCount: 'Trending'
	};

	// Derive sortBy from URL params (no effect needed)
	let sortBy = $derived(sortMap[urlParams.sort] || 'New');

	// Tags loaded from backend
	type TagItem = ListTagsResponse['tags'][number];
	let tags = $state<TagItem[]>([]);
	let tagsLoading = $state(true);
	let tagsExpanded = $state(false);

	// Load tags from API
	$effect(() => {
		if (!browser) return;
		
		(async () => {
			const { data, error } = await apiClient.GET('/tags', {
				params: {
					query: {
						limit: 50,
						sortBy: 'usageCount',
						sortOrder: 'desc'
					}
				}
			});
			
			if (data && !error) {
				tags = data.tags;
			}
			tagsLoading = false;
		})();
	});

	const sortOptions = ['New', 'Top', 'Trending'] as const;

	const sortLabels = {
		'New': () => m.home_sort_new(),
		'Top': () => m.home_sort_top(),
		'Trending': () => m.home_sort_trending()
	} as const;

	const sortMapping = {
		'New': { sortBy: 'createdAt', sortOrder: 'desc' },
		'Top': { sortBy: 'favCount', sortOrder: 'desc' },
		'Trending': { sortBy: 'viewCount', sortOrder: 'desc' }
	} as const;

	// Active tags from URL (multi-select)
	let activeTags = $derived(urlParams.tags);

	// Initialize store when sort/filter changes
	$effect(() => {
		const currentSort = sortBy; // Read derived value
		const currentTags = activeTags;
		const mapping = sortMapping[currentSort];
		const tagInclude = currentTags.length > 0 ? currentTags : undefined;
		
		// Use untrack to prevent tracking store state changes during initialize
		untrack(() => {
			artifactStore.initialize({
				sortBy: mapping.sortBy,
				sortOrder: mapping.sortOrder,
				tagInclude
			});
		});
	});

	// Responsive column count
	let columnCount = $state(3);
	$effect(() => {
		if (!browser) return;
		
		const updateColumns = () => {
			if (window.innerWidth < 768) columnCount = 1;
			else if (window.innerWidth < 1024) columnCount = 2;
			else columnCount = 3;
		};
		
		updateColumns();
		window.addEventListener('resize', updateColumns);
		return () => window.removeEventListener('resize', updateColumns);
	});

	// Page size aligned with API
	const PAGE_SIZE = 20;
	const CARD_ASPECT_RATIO = 9 / 4; // width:height ratio, must match ArtifactCard's aspect-ratio
	const CARD_PROTRUSION = 0;
	const GAP = 20;
	let gridContainerEl = $state<HTMLDivElement | null>(null);
	let gridContainerWidth = $state(0);

	$effect(() => {
		if (!gridContainerEl) return;
		const ro = new ResizeObserver((entries) => {
			gridContainerWidth = entries[0].contentRect.width;
		});
		ro.observe(gridContainerEl);
		return () => ro.disconnect();
	});

	let ITEM_HEIGHT = $derived(
		gridContainerWidth > 0
			? Math.round((gridContainerWidth - (columnCount - 1) * GAP) / columnCount / CARD_ASPECT_RATIO + CARD_PROTRUSION)
			: 268
	);

	// Helper: update URL params without triggering navigation (shallow URL update)
	// Uses native history API - this only updates the displayed URL without affecting SvelteKit routing
	function updateUrlParams(params: Record<string, string | null>) {
		if (!browser) return;
		const url = new URL(window.location.href);
		for (const [key, value] of Object.entries(params)) {
			if (value === null) {
				url.searchParams.delete(key);
			} else {
				url.searchParams.set(key, value);
			}
		}
		// Use native API for shallow URL updates (doesn't trigger SvelteKit navigation)
		window.history.replaceState(window.history.state, '', url);
	}

	// Debounced search effect - syncs search query to URL (skips on initial load)
	$effect(() => {
		if (!browser || isInitialLoad) return;
		
		const query = searchInput;
const tagInclude = activeTags.length > 0 ? activeTags : undefined;
		
		// Clear existing timer
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}
		
		// If empty, clear search and sync to URL
		if (!query.trim()) {
			untrack(() => {
				searchStore.clear();
				// Remove q from URL and reset page
				updateUrlParams({ q: null, page: '1' });
			});
			return;
		}
		
		// Skip if this query is already active (e.g., from URL init)
		if (searchStore.currentQuery === query.trim()) {
			return;
		}
		
		// Debounce the search
		debounceTimer = setTimeout(() => {
			untrack(() => {
				// Scroll to top smoothly for new search
				window.scrollTo({ top: 0, behavior: 'smooth' });
				// Sync to URL and trigger search
				updateUrlParams({ q: query.trim(), page: '1' });
				searchStore.search(query, { tagInclude });
			});
		}, DEBOUNCE_MS);
		
		return () => {
			if (debounceTimer) {
				clearTimeout(debounceTimer);
			}
		};
	});

	// Get items for virtual list (normal mode)
	function getItems(startIdx: number, endIdx: number) {
		return artifactStore.getItemsForRange(startIdx, endIdx);
	}

	// Get items for search virtual list
	function getSearchItems(startIdx: number, endIdx: number) {
		return searchStore.getItemsForRange(startIdx, endIdx);
	}

	// Handle page range changes - load required pages (normal mode)
	async function handlePageRangeChange(startPage: number, endPage: number) {
		await artifactStore.ensurePagesLoaded(startPage, endPage);
		
		// Unload distant pages to save memory
		const currentPage = Math.floor((startPage + endPage) / 2);
		artifactStore.unloadDistantPages(currentPage, 5);
	}

	// Handle search page range changes - load required pages
	async function handleSearchPageRangeChange(startPage: number, endPage: number) {
		await searchStore.ensurePagesLoaded(startPage, endPage);
		
		// Unload distant pages to save memory
		const currentPage = Math.floor((startPage + endPage) / 2);
		searchStore.unloadDistantPages(currentPage, 5);
	}

	// Unified page change handler - syncs to URL for both modes
	function handleCurrentPageChange(pageNum: number) {
		if (!browser) return;
		
		// Use window.location since $page doesn't update from history.replaceState
		const currentUrlPage = parseInt(new URL(window.location.href).searchParams.get('page') || '1');
		if (pageNum !== currentUrlPage) {
			updateUrlParams({ page: String(pageNum) });
		}
	}

	// Toggle tag selection (multi-select support)
	function toggleTag(tagSlug: string) {
		if (!browser) return;
		
		const url = new URL(window.location.href);
		const currentTags = [...activeTags];
		
		const index = currentTags.indexOf(tagSlug);
		if (index === -1) {
			// Add tag
			currentTags.push(tagSlug);
		} else {
			// Remove tag
			currentTags.splice(index, 1);
		}
		
		if (currentTags.length === 0) {
			url.searchParams.delete('tags');
		} else {
			url.searchParams.set('tags', currentTags.join(','));
		}
		url.searchParams.set('page', '1'); // Reset to page 1
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
	}

	// Clear all tag selections
	function clearAllTags() {
		if (!browser) return;
		
		const url = new URL(window.location.href);
		url.searchParams.delete('tags');
		url.searchParams.set('page', '1');
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
	}

	// Handle sort change
	function handleSortChange(newSort: 'New' | 'Top' | 'Trending') {
		if (!browser) return;
		
		const mapping = sortMapping[newSort];
		
		const url = new URL(window.location.href);
		url.searchParams.set('sort', mapping.sortBy);
		url.searchParams.set('order', mapping.sortOrder);
		url.searchParams.set('page', '1'); // Reset to page 1
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		goto(`${url.pathname}${url.search}`, { replaceState: true, noScroll: true });
	}

	// Clear search and return to normal mode
	function clearSearch() {
		searchInput = '';
		searchStore.clear();
	}

	// Back to top button state
	let showBackToTop = $state(false);
	let savedScrollPosition: number | null = $state(null);
	let reachedTop = $state(false); // Track if scroll has reached top after clicking "back to top"

	// Track scroll position for back-to-top button
	$effect(() => {
		if (!browser) return;

		const handleScroll = () => {
			const scrollY = window.scrollY;
			showBackToTop = scrollY > 400;
			
			// Only start tracking "scroll down to clear" after reaching top
			if (savedScrollPosition !== null) {
				if (scrollY < 50) {
					reachedTop = true;
				}
				// Clear saved position only if user scrolls down AFTER reaching top
				if (reachedTop && scrollY > 200) {
					savedScrollPosition = null;
					reachedTop = false;
				}
			}
		};

		window.addEventListener('scroll', handleScroll, { passive: true });
		return () => window.removeEventListener('scroll', handleScroll);
	});

	function scrollToTop() {
		if (!browser) return;
		
		// Save current position before scrolling to top
		savedScrollPosition = window.scrollY;
		reachedTop = false; // Reset so we wait for scroll to actually reach top
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	function returnToPosition() {
		if (!browser || savedScrollPosition === null) return;
		
		window.scrollTo({ top: savedScrollPosition, behavior: 'smooth' });
		savedScrollPosition = null;
	}
</script>

<div bind:this={gridContainerEl} class="mx-auto max-w-[1200px] px-4 py-6">
	<!-- Top Bar with Filters -->
	<div class="mb-6">
		<div class="flex items-center gap-4">
			<!-- Search Box -->
			<div class="relative shrink-0">
				<input
					type="text"
					bind:value={searchInput}
					placeholder={m.home_search_placeholder()}
					class="w-64 pl-10 pr-10 py-2 text-sm border border-gray-200 rounded-full bg-white focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 transition-all"
				/>
				<!-- Search Icon / Loading Spinner -->
				{#if searchStore.loading}
					<div class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4">
						<div class="animate-spin rounded-full h-4 w-4 border-2 border-gray-300 border-t-amber-500"></div>
					</div>
				{:else}
					<svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
					</svg>
				{/if}
				<!-- Clear Button -->
				{#if searchInput || searchStore.isActive}
					<button
						type="button"
						onclick={clearSearch}
						class="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 hover:text-gray-600 transition-colors"
						title={m.home_search_clear()}
					>
						<svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>

			<!-- Divider -->
			<div class="w-px h-5 bg-gray-200 shrink-0"></div>

			<!-- Sort Dropdown -->
			<div class="flex items-center gap-2 shrink-0">
				<span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">{m.home_sort_by()}</span>
				<Dropdown
					items={[...sortOptions]}
					value={sortBy}
					size="sm"
					getLabel={(option) => sortLabels[option]()}
					onchange={(option) => handleSortChange(option)}
					class="w-28"
				/>
			</div>

			<!-- Divider -->
			<div class="w-px h-5 bg-gray-200 shrink-0"></div>

			<!-- Tags + Expand button -->
			<div class="flex-1 min-w-0 flex items-center gap-1.5 overflow-hidden">
				{#if tagsLoading}
					<div class="flex items-center gap-1.5">
						{#each Array(5) as _, i (i)}
							<div class="w-16 h-8 bg-gray-100 rounded-full animate-pulse shrink-0"></div>
						{/each}
					</div>
				{:else}
					{#each tags.slice(0, 6) as tag (tag.slug)}
						<button
							onclick={() => toggleTag(tag.slug)}
							class="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap shrink-0 {activeTags.includes(tag.slug)
							? 'bg-amber-500 text-white shadow-md shadow-amber-500/25'
							: 'bg-white text-gray-700 hover:bg-amber-50 hover:text-amber-600 border border-gray-200 hover:border-amber-300'}"
						>
							{tag.name}
						</button>
					{/each}
					
					<!-- Expand button (inline with tags) -->
					{#if tags.length > 0}
						<button
							onclick={async (e) => {
								const rect = e.currentTarget.getBoundingClientRect();
								tagsExpanded = !tagsExpanded;
								if (!tagsExpanded) return;
								// Wait for DOM update then position dropdown
								await tick();
								const dropdown = document.getElementById('tags-dropdown');
								if (dropdown) {
									dropdown.style.top = `${rect.bottom + 8}px`;
									dropdown.style.right = `${window.innerWidth - rect.right}px`;
								}
							}}
							class="px-2.5 py-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors flex items-center gap-1 shrink-0 {tagsExpanded ? 'bg-gray-100 text-gray-700' : ''}"
							title="Show all tags"
						>
							{#if activeTags.length > 0}
								<span class="inline-flex items-center justify-center w-5 h-5 text-xs bg-amber-500 text-white rounded-full">{activeTags.length}</span>
							{:else if tags.length > 6}
								<span class="text-xs">+{tags.length - 6}</span>
							{/if}
							<svg class="w-4 h-4 transition-transform duration-200 {tagsExpanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
							</svg>
						</button>
					{/if}
				{/if}
			</div>
		</div>
	</div>

	<!-- Tags Dropdown (fixed position, outside overflow container) -->
	{#if tagsExpanded}
		<!-- Invisible backdrop to close on click outside -->
		<button
			class="fixed inset-0 z-40 cursor-default"
			onclick={() => tagsExpanded = false}
			tabindex="-1"
			aria-label="Close tags"
		></button>
		
		<!-- Dropdown panel -->
		<div id="tags-dropdown" class="fixed z-50 w-[420px] bg-white rounded-lg shadow-lg border border-gray-200 p-3" style="top: 0; right: 0;">
			<!-- Tags + Clear button -->
			<div class="flex flex-wrap items-center gap-1.5 max-h-48 overflow-y-auto">
				{#if activeTags.length > 0}
					<button
						onclick={clearAllTags}
						class="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors shrink-0"
					>
						Clear
					</button>
				{/if}
				{#each tags as tag (tag.slug)}
					<button
						onclick={() => toggleTag(tag.slug)}
						class="px-3 py-1 text-sm rounded-full transition-all duration-150 {activeTags.includes(tag.slug)
								? 'bg-amber-500 text-white'
								: 'bg-gray-100 text-gray-600 hover:bg-amber-50 hover:text-amber-600'}"
					>
						{tag.name}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Search Results or Virtual Grid -->
	{#if searchStore.isActive}
		<!-- Search Results Header -->
		<div class="mb-4 flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-700">
				{m.home_search_results({ query: searchStore.currentQuery })}
			</h2>
			{#if searchStore.totalItems > 0}
				<span class="text-sm text-gray-500">
					{searchStore.totalItems} results
				</span>
			{/if}
		</div>

		{#if searchStore.loading || !searchStore.initialized}
			<div class="flex justify-center items-center py-12">
				<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
			</div>
		{:else if searchStore.error}
			<div class="text-center py-12 text-red-500">
				{m.common_error({ message: searchStore.error })}
			</div>
		{:else if searchStore.totalItems === 0}
			<div class="text-center py-12 text-gray-500">
				{m.home_search_no_results({ query: searchStore.currentQuery })}
			</div>
		{:else}
			<!-- Search Results Virtual Grid -->
			<div>
				<VirtualGrid
					totalItems={searchStore.totalItems}
					itemHeight={ITEM_HEIGHT}
					gap={GAP}
					{columnCount}
					pageSize={PAGE_SIZE}
					getItems={getSearchItems}
					onPageRangeChange={handleSearchPageRangeChange}
					onCurrentPageChange={handleCurrentPageChange}
					initialPage={urlParams.page}
				>
					{#snippet children(game: ArtifactListItem)}
						<ArtifactCard artifact={game} variant="marketplace" />
					{/snippet}
					
					{#snippet placeholder()}
						<div class="bg-gray-100 rounded-xl animate-pulse" style="height: {ITEM_HEIGHT}px;"></div>
					{/snippet}
				</VirtualGrid>
			</div>
		{/if}
	{:else}
		<!-- Normal Mode: Virtual Grid -->
		{#if artifactStore.loading || !artifactStore.initialized}
		<div class="flex justify-center items-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-600"></div>
		</div>
	{:else if artifactStore.error}
		<div class="text-center py-12 text-red-500">
			{m.common_error({ message: artifactStore.error })}
		</div>
	{:else if artifactStore.totalItems === 0}
		<div class="text-center py-12 text-gray-500">
			{m.home_no_artifacts()}
		</div>
	{:else}
		<div>
			<VirtualGrid
				totalItems={artifactStore.totalItems}
				itemHeight={ITEM_HEIGHT}
				gap={GAP}
				{columnCount}
				pageSize={PAGE_SIZE}
				{getItems}
				onPageRangeChange={handlePageRangeChange}
				onCurrentPageChange={handleCurrentPageChange}
				initialPage={urlParams.page}
			>
				{#snippet children(game: ArtifactListItem)}
					<ArtifactCard artifact={game} variant="marketplace" />
				{/snippet}
				
				{#snippet placeholder()}
					<div class="bg-gray-100 rounded-xl animate-pulse" style="height: {ITEM_HEIGHT}px;"></div>
				{/snippet}
			</VirtualGrid>
		</div>
	{/if}
	{/if}
</div>

<!-- Spacer for virtual list scroll area -->
<div class="pb-8"></div>

<!-- Back to Top Button -->
{#if showBackToTop}
	<button
		onclick={scrollToTop}
		class="fixed bottom-6 right-6 z-50 w-12 h-12 bg-amber-600 rounded-full shadow-lg flex items-center justify-center text-white hover:bg-amber-700 transition-all hover:shadow-xl"
		title="Back to top"
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
		</svg>
	</button>
{/if}

<!-- Return to Previous Position Button (fixed position above back-to-top) -->
{#if savedScrollPosition !== null}
	<button
		onclick={returnToPosition}
		class="fixed bottom-20 right-6 z-50 w-12 h-12 bg-white border border-gray-200 rounded-full shadow-lg flex items-center justify-center text-gray-600 hover:bg-gray-50 hover:text-gray-800 transition-all hover:shadow-xl"
		title="Return to previous position"
	>
		<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 12H5m0 0l7 7m-7-7l7-7" />
		</svg>
	</button>
{/if}

<style>
	/* Hide scrollbar but keep scrolling */
	:global(html) {
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* IE/Edge */
	}
	:global(html::-webkit-scrollbar) {
		display: none; /* Chrome/Safari/Opera */
	}

</style>
