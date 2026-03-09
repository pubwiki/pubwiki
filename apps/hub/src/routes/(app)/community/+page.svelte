<script lang="ts">
	import type { ProjectListItem } from '@pubwiki/api';
	import { useProjectStore } from '$lib/stores/projects.svelte';
	import * as m from '$lib/paraglide/messages';

	const projectStore = useProjectStore();

	let sortBy = $state<'createdAt' | 'updatedAt'>('createdAt');
	let sortOrder = $state<'asc' | 'desc'>('desc');
	let topicFilter = $state('');

	type SortOption = { labelKey: () => string; sortBy: 'createdAt' | 'updatedAt'; sortOrder: 'asc' | 'desc' };
	const sortOptions: SortOption[] = [
		{ labelKey: () => m.community_sort_newest(), sortBy: 'createdAt', sortOrder: 'desc' },
		{ labelKey: () => m.community_sort_oldest(), sortBy: 'createdAt', sortOrder: 'asc' },
		{ labelKey: () => m.community_sort_updated(), sortBy: 'updatedAt', sortOrder: 'desc' }
	];

	// Fetch projects on mount and when sort/filter changes
	$effect(() => {
		projectStore.fetchProjects({
			sortBy,
			sortOrder,
			topic: topicFilter || undefined
		});
	});

	function handleSortChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		const option = sortOptions[parseInt(target.value)];
		if (option) {
			sortBy = option.sortBy;
			sortOrder = option.sortOrder;
		}
	}
</script>

<div class="mx-auto max-w-[1200px] px-4 py-6">
	<!-- Page Header -->
	<div class="mb-6">
		<h1 class="text-2xl font-bold text-gray-900 mb-2">{m.community_title()}</h1>
		<p class="text-gray-600">{m.community_description()}</p>
	</div>

	<!-- Top Bar with Filters -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 bg-white p-4 rounded-md border border-gray-200 shadow-sm">
		<div class="flex items-center gap-4">
			<div class="flex items-center gap-2">
				<label for="topic-filter" class="text-sm font-medium text-gray-700">{m.community_topic()}</label>
				<input
					id="topic-filter"
					type="text"
					bind:value={topicFilter}
					placeholder={m.community_topic_placeholder()}
					class="text-sm bg-gray-100 border border-gray-200 rounded px-3 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none w-48"
				/>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<label for="sort-select" class="text-xs text-gray-500">{m.community_sort_by()}</label>
			<select
				id="sort-select"
				onchange={handleSortChange}
				class="text-xs bg-gray-100 border-none rounded px-2 py-1 focus:ring-1 focus:ring-blue-500"
			>
				{#each sortOptions as option, i}
					<option value={i}>{option.labelKey()}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Projects List -->
	{#if projectStore.loading || !projectStore.initialized}
		<div class="flex justify-center items-center py-12">
			<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
		</div>
	{:else if projectStore.error}
		<div class="text-center py-12 text-red-500">
			Error: {projectStore.error}
		</div>
	{:else if projectStore.projects.length === 0}
		<div class="text-center py-12 text-gray-500">
			<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
			</svg>
			<p class="text-lg font-medium">{m.community_no_projects()}</p>
			<p class="text-sm mt-1">{m.community_be_first()}</p>
		</div>
	{:else}
		<div class="flex flex-col gap-6">
			{#each projectStore.projects as project}
				<a href="/community/{project.id}" class="group relative block h-48 rounded-xl overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition-all bg-gray-900">
					<!-- Background "Images" Grid -->
					<div class="absolute inset-0 grid grid-cols-4 gap-0.5">
						<img src="https://picsum.photos/seed/{project.id}-0/400/300" alt="" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
						<img src="https://picsum.photos/seed/{project.id}-1/400/300" alt="" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
						<img src="https://picsum.photos/seed/{project.id}-2/400/300" alt="" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
						<img src="https://picsum.photos/seed/{project.id}-3/400/300" alt="" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
					</div>
					
					<!-- Content Overlay -->
					<div class="absolute inset-0 bg-linear-to-r from-black/95 via-black/70 to-transparent/30 p-6 flex flex-col justify-center">
						<div class="max-w-2xl">
							<div class="flex items-center gap-3 mb-2">
								<span class="text-xs text-gray-300">
									{m.community_updated({ date: new Date(project.updatedAt).toLocaleDateString() })}
								</span>
							</div>
							
							<h3 class="text-2xl font-bold text-white mb-2 group-hover:text-blue-300 transition-colors drop-shadow-md">
								{project.name}
							</h3>
							
							{#if project.description}
								<p class="text-gray-200 mb-4 line-clamp-2 text-sm max-w-xl drop-shadow-md">
									{project.description}
								</p>
							{:else}
								<p class="text-gray-400 italic mb-4">{m.common_no_description()}</p>
							{/if}
							
							<div class="flex items-center gap-6 text-sm text-gray-300">
								<div class="flex items-center gap-2">
									<div class="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white">
										{(project.owner.displayName || project.owner.username)[0].toUpperCase()}
									</div>
									<span class="font-medium text-white">
										{project.owner.displayName || project.owner.username}
									</span>
								</div>
								
								<div class="flex items-center gap-4 border-l border-gray-500/50 pl-4">
									<span class="flex items-center gap-1.5" title="Artifacts">
										<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
										</svg>
										{m.community_artifacts_count({ count: (project.artifactCount ?? 0).toString() })}
									</span>
								</div>
							</div>
						</div>
					</div>
				</a>
			{/each}
		</div>

		<!-- Pagination -->
		{#if projectStore.pagination && projectStore.pagination.totalPages > 1}
			<div class="flex justify-center items-center gap-2 mt-8">
				<button
					onclick={() => projectStore.fetchProjects({ page: projectStore.pagination!.page - 1, sortBy, sortOrder, topic: topicFilter || undefined })}
					disabled={projectStore.pagination.page <= 1}
					class="px-3 py-1 text-sm rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{m.common_previous()}
				</button>
				<span class="text-sm text-gray-600">
					{m.common_page_of({ current: projectStore.pagination.page.toString(), total: projectStore.pagination.totalPages.toString() })}
				</span>
				<button
					onclick={() => projectStore.fetchProjects({ page: projectStore.pagination!.page + 1, sortBy, sortOrder, topic: topicFilter || undefined })}
					disabled={projectStore.pagination.page >= projectStore.pagination.totalPages}
					class="px-3 py-1 text-sm rounded border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{m.common_next()}
				</button>
			</div>
		{/if}
	{/if}
</div>
