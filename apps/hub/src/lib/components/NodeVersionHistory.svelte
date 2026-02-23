<script lang="ts">
	import type { NodeVersionSummary } from '@pubwiki/api';
	import { apiClient } from '$lib/api';

	type Props = {
		nodeId: string;
		currentCommit?: string;
	};

	let { nodeId, currentCommit }: Props = $props();

	// State for paginated loading
	let versions = $state<NodeVersionSummary[]>([]);
	let loadingMore = $state(false);
	let hasMore = $state(true);
	let cursor = $state<string | null>(null);
	
	// Initial load promise - created once per nodeId
	let initialLoadPromise = $state<Promise<void> | null>(null);
	let lastLoadedNodeId = $state<string | null>(null);

	// Load versions (for pagination)
	async function loadMoreVersions() {
		if (loadingMore || !hasMore) return;

		loadingMore = true;
		try {
			const { data, error: apiError } = await apiClient.GET('/nodes/{nodeId}/versions', {
				params: {
					path: { nodeId },
					query: { cursor: cursor ?? undefined, limit: 20 }
				}
			});

			if (!apiError && data) {
				const newVersions = data.versions ?? [];
				versions = [...versions, ...newVersions];
				cursor = data.nextCursor ?? null;
				hasMore = data.nextCursor != null;
			}
		} finally {
			loadingMore = false;
		}
	}

	// Create initial load promise
	function createInitialLoad(): Promise<void> {
		return apiClient.GET('/nodes/{nodeId}/versions', {
			params: {
				path: { nodeId },
				query: { limit: 20 }
			}
		}).then(({ data, error: apiError }) => {
			if (apiError) {
				throw new Error(apiError.error || 'Failed to load versions');
			}
			if (data) {
				versions = data.versions ?? [];
				cursor = data.nextCursor ?? null;
				hasMore = data.nextCursor != null;
			}
		});
	}

	// Initialize load when nodeId is available or changes
	$effect(() => {
		if (nodeId && nodeId !== lastLoadedNodeId) {
			versions = [];
			cursor = null;
			hasMore = true;
			lastLoadedNodeId = nodeId;
			initialLoadPromise = createInitialLoad();
		}
	});

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleString();
	}

	function getRelativeTime(dateStr: string): string {
		const date = new Date(dateStr);
		const now = new Date();
		const diff = now.getTime() - date.getTime();
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'just now';
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h4 class="text-sm font-semibold text-gray-700">Version History</h4>
		{#if versions.length > 0}
			<span class="text-xs text-gray-500">{versions.length}{hasMore ? '+' : ''} versions</span>
		{/if}
	</div>

	{#if initialLoadPromise}
		{#await initialLoadPromise}
			<div class="flex items-center justify-center py-4">
				<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
			</div>
		{:then}
			{#if versions.length === 0}
				<div class="text-sm text-gray-500 italic py-4 text-center">
					No version history available.
				</div>
			{:else}
				<div class="space-y-2 max-h-[300px] overflow-y-auto pr-1">
			{#each versions as version}
				<div 
					class="p-2 rounded border text-xs {version.commit === currentCommit 
						? 'border-blue-300 bg-blue-50' 
						: 'border-gray-200 bg-white hover:bg-gray-50'}"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<code class="font-mono text-gray-700">
									{version.commit.slice(0, 8)}
								</code>
								{#if version.commit === currentCommit}
									<span class="text-[10px] px-1.5 py-0.5 bg-blue-500 text-white rounded">
										current
									</span>
								{/if}
								{#if version.tag}
									<span class="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
										{version.tag}
									</span>
								{/if}
							</div>
							{#if version.message}
								<p class="text-gray-600 mt-1 truncate">{version.message}</p>
							{/if}
						</div>
						<span class="text-gray-400 shrink-0" title={formatDate(version.authoredAt)}>
							{getRelativeTime(version.authoredAt)}
						</span>
					</div>
					{#if version.parent}
						<div class="mt-1 text-[10px] text-gray-400">
							parent: <code class="font-mono">{version.parent.slice(0, 8)}</code>
						</div>
					{/if}
				</div>
			{/each}
			
			{#if loadingMore}
				<div class="flex items-center justify-center py-2">
					<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
				</div>
			{:else if hasMore}
				<button
					onclick={() => loadMoreVersions()}
					class="w-full py-2 text-xs text-[#0969da] hover:bg-gray-50 rounded border border-dashed border-gray-300"
				>
					Load more versions
				</button>
			{/if}
				</div>
			{/if}
		{:catch error}
			<div class="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-200">
				{error.message || 'Failed to load versions'}
			</div>
		{/await}
	{:else}
		<div class="flex items-center justify-center py-4">
			<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
		</div>
	{/if}
</div>
