<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { untrack } from 'svelte';
	import { useArtifactStore } from '$lib/stores/artifacts.svelte';
	import VirtualGrid from '$lib/components/VirtualGrid.svelte';
	import type { ArtifactListItem } from '@pubwiki/api';
	import * as m from '$lib/paraglide/messages';

	const artifactStore = useArtifactStore();

	// URL params for persistence
	const urlParams = $derived.by(() => {
		const params = $page.url.searchParams;
		return {
			page: parseInt(params.get('page') || '1'),
			sort: (params.get('sort') || 'createdAt') as 'createdAt' | 'viewCount' | 'favCount',
			order: (params.get('order') || 'desc') as 'asc' | 'desc',
			tag: params.get('tag') || null
		};
	});

	const sortMap: Record<string, 'New' | 'Top' | 'Trending'> = {
		createdAt: 'New',
		favCount: 'Top',
		viewCount: 'Trending'
	};

	// Derive sortBy from URL params (no effect needed)
	let sortBy = $derived(sortMap[urlParams.sort] || 'New');

	const filters = ['All', 'Sci-Fi', 'Fantasy', 'Xianxia', 'Cyberpunk', 'Horror', 'Strategy', 'Survival'];
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

	// Active filter from URL or default
	let activeFilter = $derived(urlParams.tag || 'All');

	// Initialize store when sort/filter changes
	$effect(() => {
		const currentSort = sortBy; // Read derived value
		const currentFilter = activeFilter;
		const mapping = sortMapping[currentSort];
		const tagInclude = currentFilter !== 'All' ? [currentFilter] : undefined;
		
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
	const ITEM_HEIGHT = 220; // Card height in pixels

	// Get items for virtual list
	function getItems(startIdx: number, endIdx: number) {
		return artifactStore.getItemsForRange(startIdx, endIdx);
	}

	// Handle page range changes - load required pages
	async function handlePageRangeChange(startPage: number, endPage: number) {
		await artifactStore.ensurePagesLoaded(startPage, endPage);
		
		// Unload distant pages to save memory
		const currentPage = Math.floor((startPage + endPage) / 2);
		artifactStore.unloadDistantPages(currentPage, 5);
	}

	// Handle current page change - update URL
	function handleCurrentPageChange(pageNum: number) {
		if (!browser) return;
		
		const url = new URL(window.location.href);
		const currentUrlPage = parseInt(url.searchParams.get('page') || '1');
		
		if (pageNum !== currentUrlPage) {
			url.searchParams.set('page', String(pageNum));
			history.replaceState({}, '', url);
		}
	}

	// Handle filter change
	function handleFilterChange(filter: string) {
		if (!browser) return;
		
		const url = new URL(window.location.href);
		if (filter === 'All') {
			url.searchParams.delete('tag');
		} else {
			url.searchParams.set('tag', filter);
		}
		url.searchParams.set('page', '1'); // Reset to page 1
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	// Handle sort change
	function handleSortChange(newSort: 'New' | 'Top' | 'Trending') {
		if (!browser) return;
		
		const mapping = sortMapping[newSort];
		
		const url = new URL(window.location.href);
		url.searchParams.set('sort', mapping.sortBy);
		url.searchParams.set('order', mapping.sortOrder);
		url.searchParams.set('page', '1'); // Reset to page 1
		goto(url.toString(), { replaceState: true, noScroll: true });
	}

	// 3D tilt effect handler for playing card
	let rafId: number | null = null;
	
	function handleCardPointerMove(e: PointerEvent) {
		if (rafId) return;
		
		const card = e.currentTarget as HTMLElement;
		const clientX = e.clientX;
		const clientY = e.clientY;
		
		rafId = requestAnimationFrame(() => {
			if (!card) { rafId = null; return; }
			
			const rect = card.getBoundingClientRect();
			const x = clientX - rect.left;
			const y = clientY - rect.top;
			const centerX = rect.width / 2;
			const centerY = rect.height / 2;
			const rotateX = (y - centerY) / 4;
			const rotateY = (centerX - x) / 4;
			
			card.style.setProperty('--rotateX', `${rotateX}deg`);
			card.style.setProperty('--rotateY', `${rotateY}deg`);
			rafId = null;
		});
	}

	function handleCardPointerLeave(e: PointerEvent) {
		if (rafId) {
			cancelAnimationFrame(rafId);
			rafId = null;
		}
		const card = e.currentTarget as HTMLElement;
		card.style.setProperty('--rotateX', '0deg');
		card.style.setProperty('--rotateY', '0deg');
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

<div class="mx-auto max-w-[1200px] px-4 py-6">
	<!-- Top Bar with Filters -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white p-4 rounded-md border border-gray-200 shadow-sm">
		<div class="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
			<span class="text-sm font-bold text-gray-700 whitespace-nowrap">{m.home_tags()}</span>
			{#each filters as filter}
				<button
					onclick={() => handleFilterChange(filter)}
					class="px-3 py-1 text-xs font-medium rounded-sm transition whitespace-nowrap {activeFilter === filter
						? 'bg-[#0969da] text-white'
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				>
					{filter === 'All' ? m.home_all() : filter}
				</button>
			{/each}
		</div>

		<div class="flex items-center gap-2">
			<span class="text-xs text-gray-500">{m.home_sort_by()}</span>
			<select 
				value={sortBy}
				onchange={(e) => handleSortChange(e.currentTarget.value as 'New' | 'Top' | 'Trending')}
				class="text-xs bg-gray-100 border-none rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
			>
				{#each sortOptions as option}
					<option value={option}>{sortLabels[option]()}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Virtual Grid -->
	{#if artifactStore.loading}
		<div class="flex justify-center items-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
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
				gap={20}
				{columnCount}
				pageSize={PAGE_SIZE}
				{getItems}
				onPageRangeChange={handlePageRangeChange}
				onCurrentPageChange={handleCurrentPageChange}
				initialPage={urlParams.page}
			>
				{#snippet children(game: ArtifactListItem, index: number)}
					<div class="group bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100 overflow-visible">
						<div class="flex h-full">
							<!-- Cover Image (Playing Card Style) -->
							<div class="w-[38%] min-w-[150px] flex items-center justify-center py-4 pl-2 pr-1 relative">
								<a 
									href="/artifact/{game.id}" 
									class="playing-card relative block w-[140px] h-[196px] z-10 -mt-6 -ml-6"
									style="--rotateX: 0deg; --rotateY: 0deg;"
									onpointermove={handleCardPointerMove}
									onpointerleave={handleCardPointerLeave}
								>
									<div class="absolute inset-0 bg-black/15 rounded-lg translate-x-1 translate-y-1 blur-sm"></div>
									<div class="relative w-full h-full bg-white rounded-lg border-2 border-gray-200 shadow-lg overflow-hidden">
										<img
											src={game.thumbnailUrl || 'https://placehold.co/280x392/e5e7eb/9ca3af?text=No+Cover'}
											alt={game.name}
											class="w-full h-full object-cover"
										/>
										<div class="absolute inset-0 bg-gradient-to-br from-white/20 via-transparent to-transparent pointer-events-none"></div>
									</div>
								</a>
							</div>
							
							<!-- Content -->
							<div class="flex-1 p-4 flex flex-col min-w-0 bg-gradient-to-br from-white to-gray-50/50">
								<a href="/artifact/{game.id}" class="block mb-1">
									<h3 class="font-bold text-gray-800 group-hover:text-gray-600 text-base leading-tight line-clamp-2 h-[2.5rem] transition-colors" title={game.name}>
										{game.name}
									</h3>
								</a>
								
								<a 
									href="/user/{game.author.id}" 
									class="text-xs text-gray-500 hover:text-gray-700 hover:underline mb-2 truncate transition-colors"
									onclick={(e) => e.stopPropagation()}
								>
									{m.common_by({ author: game.author.displayName || game.author.username })}
								</a>
								
								<p class="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-2 h-[2.25rem]">
									{game.description || ''}
								</p>
								
								{#if game.tags && game.tags.length > 0}
									<div class="relative mb-3 h-5 overflow-hidden">
										<div class="flex gap-1 absolute top-0 left-0 right-0">
											{#each game.tags as tag}
												<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full whitespace-nowrap">
													{tag.name}
												</span>
											{/each}
										</div>
										<div class="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-gray-50 to-transparent pointer-events-none"></div>
									</div>
								{/if}
								
								<div class="flex items-center gap-4 text-xs text-gray-400 pt-2 border-t border-gray-100">
									<span class="flex items-center gap-1" title={m.common_views()}>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
										{(game.stats?.viewCount ?? 0).toLocaleString()}
									</span>
									<span class="flex items-center gap-1 text-rose-400" title={m.common_stars()}>
										<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
										{game.stats?.favCount ?? 0}
									</span>
								</div>
							</div>
						</div>
					</div>
				{/snippet}
				
				{#snippet placeholder(index: number)}
					<div class="bg-gray-100 rounded-xl animate-pulse" style="height: {ITEM_HEIGHT}px;"></div>
				{/snippet}
			</VirtualGrid>
		</div>
	{/if}
</div>

<!-- Spacer for virtual list scroll area -->
<div class="pb-8"></div>

<!-- Back to Top Button -->
{#if showBackToTop}
	<button
		onclick={scrollToTop}
		class="fixed bottom-6 right-6 z-50 w-12 h-12 bg-[#0969da] rounded-full shadow-lg flex items-center justify-center text-white hover:bg-[#0860c7] transition-all hover:shadow-xl"
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

	.playing-card {
		transform-style: preserve-3d;
		will-change: transform;
		touch-action: none;
		transform: perspective(800px) rotateX(var(--rotateX)) rotateY(var(--rotateY)) rotate(-6deg) scale(1);
		transition: transform 0.15s ease-out;
	}
	
	.playing-card:hover {
		transform: perspective(800px) rotateX(var(--rotateX)) rotateY(var(--rotateY)) rotate(-6deg) scale(1.15);
	}
</style>
