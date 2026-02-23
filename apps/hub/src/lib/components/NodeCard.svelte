<script lang="ts">
	import type { ArtifactNodeSummary } from '@pubwiki/api';
	import { useArtifactStore, type ArtifactNodeDetail } from '$lib/stores/artifacts.svelte';
	import { FileTree, buildTreeFromPaths } from './FileTree';
	import NodeVersionHistory from './NodeVersionHistory.svelte';

	type Props = {
		node: ArtifactNodeSummary;
		artifactId: string;
	};

	let { node, artifactId }: Props = $props();
	
	const artifactStore = useArtifactStore();
	
	// Content is now directly available in node.content from ArtifactNodeSummary
	let content = $derived(node.content ? JSON.stringify(node.content, null, 2) : null);
	let vfsDetailPromise = $state<Promise<ArtifactNodeDetail | null> | null>(null);
	let expanded = $state(false);
	let showVersionHistory = $state(false);
	let vfsExpandedFolders = $state(new Set<string>());

	// Load VFS detail lazily when expanded
	function loadVfsDetail() {
		if (node.type !== 'VFS' || vfsDetailPromise) return;
		vfsDetailPromise = artifactStore.fetchNodeDetail(artifactId, node.id);
	}
	
	// Handle expand - trigger VFS load if needed
	function handleExpand() {
		expanded = !expanded;
		if (expanded && node.type === 'VFS') {
			loadVfsDetail();
		}
	}

	function getNodeTypeBadgeColor(type: string): string {
		switch (type) {
			case 'PROMPT': return 'bg-blue-100 text-blue-700';
			case 'INPUT': return 'bg-purple-100 text-purple-700';
			case 'GENERATED': return 'bg-green-100 text-green-700';
			case 'VFS': return 'bg-orange-100 text-orange-700';
			default: return 'bg-gray-100 text-gray-700';
		}
	}
</script>

<div 
	class="rounded-lg border border-gray-200 bg-gray-50 p-4 transition-all hover:border-gray-300"
>
	<div 
		class="flex items-start gap-3 cursor-pointer"
		onclick={handleExpand}
		onkeydown={(e) => e.key === 'Enter' && handleExpand()}
		role="button"
		tabindex="0"
	>
		<!-- Node Info -->
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2 flex-wrap">
				<h4 class="font-semibold text-gray-900 truncate">
					{node.name || `Node ${node.id.substring(0, 8)}`}
				</h4>
				<span class="text-xs px-2 py-0.5 rounded-full {getNodeTypeBadgeColor(node.type)}">
					{node.type}
				</span>
			</div>
			
			<div class="flex items-center gap-2 mt-1">
				<p class="text-xs text-gray-500 font-mono truncate">
					ID: {node.id.substring(0, 8)}...
				</p>
				<span class="text-gray-300">|</span>
				<p class="text-xs text-gray-500 font-mono">
					commit: {node.commit.substring(0, 8)}
				</p>
			</div>
		</div>

		<!-- Expand indicator -->
		<div class="text-gray-400 transition-transform {expanded ? 'rotate-180' : ''}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
			</svg>
		</div>
	</div>

	<!-- Expanded content -->
	{#if expanded}
		<div class="mt-4 pt-4 border-t border-gray-200" role="region">
			<!-- Tab buttons -->
			<div class="flex gap-2 mb-3">
				<button
					onclick={() => showVersionHistory = false}
					class="text-xs px-3 py-1 rounded-full transition-colors {!showVersionHistory 
						? 'bg-gray-800 text-white' 
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				>
					Content
				</button>
				<button
					onclick={() => showVersionHistory = true}
					class="text-xs px-3 py-1 rounded-full transition-colors {showVersionHistory 
						? 'bg-gray-800 text-white' 
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
				>
					Version History
				</button>
			</div>

			{#if showVersionHistory}
				<NodeVersionHistory nodeId={node.id} currentCommit={node.commit} />
			{:else if node.type === 'VFS'}
				{#if vfsDetailPromise}
					{#await vfsDetailPromise}
						<div class="flex items-center gap-2 text-sm text-gray-500">
							<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
							Loading files...
						</div>
					{:then nodeDetail}
						{@const vfsFilePaths = nodeDetail?.files?.map(f => f.filepath) ?? []}
						{#if vfsFilePaths.length > 0}
							<FileTree 
								items={buildTreeFromPaths(vfsFilePaths)}
								expandedFolders={vfsExpandedFolders}
								onExpandedChange={(folders) => vfsExpandedFolders = folders}
							/>
						{:else}
							<p class="text-sm text-gray-500 italic">
								No files in this VFS node.
							</p>
						{/if}
					{:catch}
						<p class="text-sm text-red-500 italic">
							Failed to load files.
						</p>
					{/await}
				{:else}
					<div class="flex items-center gap-2 text-sm text-gray-500">
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
						Loading files...
					</div>
				{/if}
			{:else if content}
				<div class="bg-white rounded-md p-3 overflow-x-auto border border-gray-100">
					<pre class="text-xs text-gray-700 whitespace-pre-wrap font-mono">{content}</pre>
				</div>
			{:else}
				<p class="text-sm text-gray-500 italic">
					No content available.
				</p>
			{/if}
		</div>
	{/if}
</div>