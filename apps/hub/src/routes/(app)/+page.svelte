<script lang="ts">
	import type { ArtifactListItem } from '$lib/types';
	import { useArtifactStore } from '$lib/stores/artifacts.svelte';
	import * as m from '$lib/paraglide/messages';

	const artifactStore = useArtifactStore();

	let activeFilter = $state('All');
	let sortBy = $state<'New' | 'Top' | 'Trending'>('New');

	const filters = ['All', 'Sci-Fi', 'Fantasy', 'Xianxia', 'Cyberpunk', 'Horror', 'Strategy', 'Survival'];
	const sortOptions = ['New', 'Top', 'Trending'] as const;

	// Get translated sort option labels
	const sortLabels = {
		'New': () => m.home_sort_new(),
		'Top': () => m.home_sort_top(),
		'Trending': () => m.home_sort_trending()
	} as const;

	// Map UI sort options to API sort fields
	const sortMapping = {
		'New': { sortBy: 'createdAt', sortOrder: 'desc' },
		'Top': { sortBy: 'starCount', sortOrder: 'desc' },
		'Trending': { sortBy: 'viewCount', sortOrder: 'desc' }
	} as const;

	// Fetch artifacts on mount and when sort changes
	$effect(() => {
		const mapping = sortMapping[sortBy];
		artifactStore.fetchArtifacts({
			sortBy: mapping.sortBy,
			sortOrder: mapping.sortOrder
		});
	});

	let filteredGames = $derived(
		activeFilter === 'All'
			? artifactStore.artifacts
			: artifactStore.artifacts.filter((game) => 
				game.tags?.some((tag) => tag.name.toLowerCase().includes(activeFilter.toLowerCase()))
			)
	);
</script>

<div class="mx-auto max-w-[1200px] px-4 py-6">
	<!-- Top Bar with Filters -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white p-4 rounded-md border border-gray-200 shadow-sm">
		<div class="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
			<span class="text-sm font-bold text-gray-700 whitespace-nowrap">{m.home_tags()}</span>
			{#each filters as filter}
				<button
					onclick={() => (activeFilter = filter)}
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
				bind:value={sortBy}
				class="text-xs bg-gray-100 border-none rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
			>
				{#each sortOptions as option}
					<option value={option}>{sortLabels[option]()}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Games Grid (Steam-like compact list/grid) -->
	{#if artifactStore.loading}
		<div class="flex justify-center items-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
		</div>
	{:else if artifactStore.error}
		<div class="text-center py-12 text-red-500">
			{m.common_error({ message: artifactStore.error })}
		</div>
	{:else if filteredGames.length === 0}
		<div class="text-center py-12 text-gray-500">
			{m.home_no_artifacts()}
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each filteredGames as game}
				<a href="/artifact/{game.id}" class="group block bg-white border border-gray-200 rounded-lg transition-all duration-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5">
					<div class="flex h-full">
						<!-- Image -->
						<div class="w-1/3 min-w-[120px] relative overflow-hidden rounded-l-lg">
							<img
								src={game.thumbnailUrl || 'https://placehold.co/800x400/222/fff?text=No+Image'}
								alt={game.name}
								class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
							/>
						</div>
						
						<!-- Content -->
						<div class="flex-1 p-3 flex flex-col justify-between min-w-0">
							<div>
								<h3 class="font-bold text-[#0969da] group-hover:underline text-sm mb-1 truncate" title={game.name}>
									{game.name}
								</h3>
								<p class="text-xs text-gray-500 mb-2 truncate">{m.common_by({ author: game.author.displayName || game.author.username })}</p>
								<div class="relative mb-2 h-6 overflow-hidden">
									<div class="flex gap-1 absolute top-0 left-0 right-0">
										{#each game.tags as tag}
											<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200 whitespace-nowrap">
												{tag.name}
											</span>
										{/each}
									</div>
									<div class="absolute right-0 top-0 bottom-0 w-8 bg-linear-to-l from-white to-transparent pointer-events-none"></div>
								</div>
							</div>
							
							<div class="flex items-center justify-between text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
								<div class="flex items-center gap-3">
									<span class="flex items-center gap-1" title={m.common_views()}>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
										{(game.stats?.viewCount ?? 0).toLocaleString()}
									</span>
									<span class="flex items-center gap-1" title={m.common_stars()}>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
										{game.stats?.starCount ?? 0}
									</span>
								</div>
								<span class="text-green-600 font-medium">{m.common_free()}</span>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
