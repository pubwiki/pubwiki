<script lang="ts">
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import type { ArtifactListItem, Pagination } from '@pubwiki/api';
	import { apiClient } from '$lib/api';

	let userId = $derived($page.params.id);

	// User info (extracted from first artifact's author data)
	let username = $state('');
	let displayName = $state<string | null>(null);
	let avatarUrl = $state<string | null>(null);
	let userLoaded = $state(false);

	// Artifacts state
	let artifacts = $state<ArtifactListItem[]>([]);
	let artifactsLoading = $state(false);
	let artifactsPagination = $state<Pagination | null>(null);

	$effect(() => {
		if (browser && userId) {
			fetchArtifacts(1);
		}
	});

	async function fetchArtifacts(pageNum = 1) {
		if (!userId) return;
		artifactsLoading = true;
		try {
			const { data } = await apiClient.GET('/users/{userId}/artifacts', {
				params: {
					path: { userId },
					query: { page: pageNum, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }
				}
			});
			if (data) {
				artifacts = data.artifacts;
				artifactsPagination = data.pagination;

				// Extract user info from first artifact's author
				if (!userLoaded && data.artifacts.length > 0) {
					const author = data.artifacts[0].author;
					username = author.username;
					displayName = author.displayName ?? null;
					avatarUrl = author.avatarUrl ?? null;
					userLoaded = true;
				}
			}
		} catch (e) {
			console.error('Failed to fetch user artifacts:', e);
		} finally {
			artifactsLoading = false;
		}
	}

	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="min-h-screen bg-[#f6f8fa]">
	<div class="mx-auto max-w-[1200px] px-4 py-8">
		<!-- User Header -->
		<div class="mb-8 flex items-center gap-4">
			<img
				src={avatarUrl || `https://ui-avatars.com/api/?name=${username || userId}&background=random&size=80`}
				alt={username || 'User'}
				class="h-20 w-20 rounded-full border-2 border-white shadow"
			/>
			<div>
				{#if userLoaded}
					<h1 class="text-2xl font-bold text-gray-900">
						{displayName || username}
					</h1>
					<p class="text-gray-500">@{username}</p>
				{:else}
					<div class="h-8 w-48 bg-gray-200 rounded animate-pulse"></div>
					<div class="h-5 w-32 bg-gray-200 rounded animate-pulse mt-1"></div>
				{/if}
			</div>
		</div>

		<!-- Artifacts List -->
		<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
			<div class="px-4 py-3 border-b border-gray-200">
				<h2 class="text-lg font-semibold text-gray-900">Artifacts</h2>
			</div>

			{#if artifactsLoading && artifacts.length === 0}
				<div class="p-8 text-center text-gray-500">Loading...</div>
			{:else if artifacts.length === 0}
				<div class="p-8 text-center text-gray-500">
					<svg class="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
					</svg>
					<p>This user has no public artifacts yet.</p>
				</div>
			{:else}
				<ul class="divide-y divide-gray-100">
					{#each artifacts as artifact (artifact.id)}
						<li class="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
							<a href={resolve(`/artifact/${artifact.id}`)} class="flex items-center gap-4 flex-1 min-w-0">
								<img
									src={artifact.thumbnailUrl || 'https://placehold.co/48x48/222/fff?text=?'}
									alt={artifact.name}
									class="w-12 h-12 rounded object-cover border border-gray-200"
								/>
								<div class="flex-1 min-w-0">
									<h3 class="text-sm font-semibold text-gray-900 hover:text-[#0969da] truncate">{artifact.name}</h3>
									<p class="text-xs text-gray-500 truncate">{artifact.description || 'No description'}</p>
								</div>
								<div class="text-right shrink-0">
									<p class="text-xs text-gray-400">{formatDate(artifact.createdAt)}</p>
								</div>
							</a>
						</li>
					{/each}
				</ul>

				{#if artifactsPagination && artifactsPagination.totalPages > 1}
					<div class="px-4 py-3 border-t border-gray-200 flex justify-center gap-2">
						<button
							onclick={() => fetchArtifacts(artifactsPagination!.page - 1)}
							disabled={artifactsPagination.page <= 1}
							class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							Previous
						</button>
						<span class="px-3 py-1 text-sm text-gray-600">
							Page {artifactsPagination.page} of {artifactsPagination.totalPages}
						</span>
						<button
							onclick={() => fetchArtifacts(artifactsPagination!.page + 1)}
							disabled={artifactsPagination.page >= artifactsPagination.totalPages}
							class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
						>
							Next
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</div>
