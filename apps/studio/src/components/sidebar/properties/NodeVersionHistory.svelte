<script lang="ts">
	/**
	 * NodeVersionHistory - Version history panel for Studio sidebar
	 * 
	 * Displays merged version history from:
	 * - Local snapshots (IndexedDB) - marked with local indicator
	 * - Cloud versions (API) - marked with cloud indicator
	 * 
	 * Features:
	 * - Scroll-to-load for cloud versions
	 * - Visual distinction between local and cloud sources
	 * - Current version highlight
	 * - Relative time display
	 */
	import { createVersionListStore } from '$lib/version';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		currentCommit?: string;
	}

	let { nodeId, currentCommit }: Props = $props();

	const versionStore = createVersionListStore();

	// Initialize store when nodeId changes
	$effect(() => {
		if (nodeId) {
			versionStore.init(nodeId);
		}
	});

	// Reactive access to merged versions
	let versions = $derived(versionStore.mergedVersions);
	let loading = $derived(versionStore.loading);
	let hasMore = $derived(versionStore.hasMore);
	let error = $derived(versionStore.error);

	function formatDate(timestamp: number): string {
		if (!timestamp) return '';
		return new Date(timestamp).toLocaleString();
	}

	function getRelativeTime(timestamp: number): string {
		if (!timestamp) return '';
		const now = Date.now();
		const diff = now - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ago`;
		if (hours > 0) return `${hours}h ago`;
		if (minutes > 0) return `${minutes}m ago`;
		return 'just now';
	}

	function handleLoadMore() {
		versionStore.loadMore();
	}

	// Source icon color classes
	function getSourceStyle(source: 'local' | 'cloud'): { bg: string; text: string; title: string } {
		if (source === 'local') {
			return { 
				bg: 'bg-amber-100', 
				text: 'text-amber-700',
				title: 'Local snapshot'
			};
		}
		return { 
			bg: 'bg-sky-100', 
			text: 'text-sky-700',
			title: 'Cloud version'
		};
	}
</script>

<div class="space-y-3">
	<div class="flex items-center justify-between">
		<h4 class="text-sm font-semibold text-gray-700">{m.studio_version_history()}</h4>
		{#if versions.length > 0}
			<span class="text-xs text-gray-500">
				{versions.length}{hasMore ? '+' : ''} versions
			</span>
		{/if}
	</div>

	{#if error}
		<div class="text-sm text-red-600 bg-red-50 p-2 rounded border border-red-200">
			{error}
		</div>
	{/if}

	{#if versions.length === 0 && !loading}
		<div class="text-sm text-gray-500 italic py-4 text-center">
			{m.studio_no_version_history()}
		</div>
	{:else}
		<div class="space-y-2 max-h-[250px] overflow-y-auto pr-1">
			{#each versions as version (version.commit)}
				{@const sourceStyle = getSourceStyle(version.source)}
				<div 
					class="p-2 rounded border text-xs transition-colors {version.commit === currentCommit 
						? 'border-blue-300 bg-blue-50' 
						: 'border-gray-200 bg-white hover:bg-gray-50'}"
				>
					<div class="flex items-start justify-between gap-2">
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<code class="font-mono text-gray-700">
									{version.commit.slice(0, 8)}
								</code>
								<!-- Source indicator -->
								<span 
									class="text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 {sourceStyle.bg} {sourceStyle.text}"
									title={sourceStyle.title}
								>
									{#if version.source === 'local'}
										<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
										</svg>
										local
									{:else}
										<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
										</svg>
										cloud
									{/if}
								</span>
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
							{#if version.name}
								<p class="text-gray-500 mt-0.5 truncate text-[10px]">{version.name}</p>
							{/if}
						</div>
						<span 
							class="text-gray-400 shrink-0" 
							title={formatDate(version.timestamp)}
						>
							{getRelativeTime(version.timestamp)}
						</span>
					</div>
					{#if version.parent}
						<div class="mt-1 text-[10px] text-gray-400">
							parent: <code class="font-mono">{version.parent.slice(0, 8)}</code>
						</div>
					{/if}
				</div>
			{/each}
			
			{#if loading}
				<div class="flex items-center justify-center py-2">
					<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
				</div>
			{:else if hasMore}
				<button
					onclick={handleLoadMore}
					class="w-full py-2 text-xs text-blue-600 hover:bg-gray-50 rounded border border-dashed border-gray-300 transition-colors"
				>
					{m.studio_load_more_versions()}
				</button>
			{/if}
		</div>
	{/if}
</div>
