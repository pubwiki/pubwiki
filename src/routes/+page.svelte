<script lang="ts">
	import type { Artifact } from '$lib/types';
	import { mockArtifacts } from '$lib/mockData';

	// Use mock artifacts
	let games = $state<Artifact[]>(mockArtifacts);

	let activeFilter = $state('All');
	let sortBy = $state('New');

	const filters = ['All', 'Sci-Fi', 'Fantasy', 'Xianxia', 'Cyberpunk', 'Horror', 'Strategy', 'Survival'];
	const sortOptions = ['New', 'Top', 'Trending'];

	let filteredGames = $derived(
		activeFilter === 'All'
			? games
			: games.filter((game) => game.tags.some((tag) => tag.includes(activeFilter)))
	);
</script>

<div class="mx-auto max-w-[1200px] px-4 py-6">
	<!-- Top Bar with Filters -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white p-4 rounded-md border border-gray-200 shadow-sm">
		<div class="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0">
			<span class="text-sm font-bold text-gray-700 whitespace-nowrap">Tags:</span>
			{#each filters as filter}
				<button
					onclick={() => (activeFilter = filter)}
					class="px-3 py-1 text-xs font-medium rounded-sm transition whitespace-nowrap {activeFilter === filter
						? 'bg-[#0969da] text-white'
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				>
					{filter}
				</button>
			{/each}
		</div>

		<div class="flex items-center gap-2">
			<span class="text-xs text-gray-500">Sort by:</span>
			<select 
				bind:value={sortBy}
				class="text-xs bg-gray-100 border-none rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
			>
				{#each sortOptions as option}
					<option value={option}>{option}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Games Grid (Steam-like compact list/grid) -->
	<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
		{#each filteredGames as game}
			<a href="/game/{game.id}" class="group block bg-white border border-gray-200 rounded-lg transition-all duration-200 shadow-sm hover:shadow-lg hover:-translate-y-0.5">
				<div class="flex h-full">
					<!-- Image -->
					<div class="w-1/3 min-w-[120px] relative overflow-hidden rounded-l-lg">
						<img
							src={game.coverImage}
							alt={game.title}
							class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
						/>
					</div>
					
					<!-- Content -->
					<div class="flex-1 p-3 flex flex-col justify-between">
						<div>
							<h3 class="font-bold text-[#0969da] group-hover:underline text-sm mb-1 line-clamp-1">
								{game.title}
							</h3>
							<p class="text-xs text-gray-500 mb-2">by {game.owner_name}</p>
							<div class="flex flex-wrap gap-1 mb-2">
								{#each game.tags.slice(0, 3) as tag}
									<span class="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded border border-gray-200">
										{tag}
									</span>
								{/each}
							</div>
						</div>
						
						<div class="flex items-center justify-between text-xs text-gray-500 mt-2 pt-2 border-t border-gray-100">
							<div class="flex items-center gap-3">
								<span class="flex items-center gap-1" title="Views">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
									{game.stats.views.toLocaleString()}
								</span>
								<span class="flex items-center gap-1" title="Stars">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
									{game.stats.stars}
								</span>
							</div>
							<span class="text-green-600 font-medium">Free</span>
						</div>
					</div>
				</div>
			</a>
		{/each}
	</div>
</div>


