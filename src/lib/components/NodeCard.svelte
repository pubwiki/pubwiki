<script lang="ts">
	import type { ArtifactNodeSummary } from '$lib/types';
	import { useArtifactStore, type ArtifactNodeDetail } from '$lib/stores/artifacts.svelte';
	import { FileTree, buildTreeFromPaths } from './FileTree';

	type Props = {
		node: ArtifactNodeSummary;
		artifactId: string;
	};

	let { node, artifactId }: Props = $props();
	
	const artifactStore = useArtifactStore();
	
	let content = $state<string | null>(null);
	let nodeDetail = $state<ArtifactNodeDetail | null>(null);
	let loadingContent = $state(false);
	let expanded = $state(false);
	let vfsExpandedFolders = $state(new Set<string>());

	// Load content for non-VFS nodes
	async function loadContent() {
		if (node.external) return;
		
		loadingContent = true;
		try {
			if (node.type === 'VFS') {
				// For VFS nodes, fetch node detail to get file list
				const result = await artifactStore.fetchNodeDetail(artifactId, node.id);
				if (result) {
					nodeDetail = result;
				}
			} else {
				// For other nodes, fetch text content
				const result = await artifactStore.fetchNodeContent(artifactId, node.id);
				if (result) {
					content = result;
				}
			}
		} catch {
			content = null;
			nodeDetail = null;
		} finally {
			loadingContent = false;
		}
	}

	// Load content when card is expanded
	$effect(() => {
		if (expanded && content === null && nodeDetail === null && !loadingContent) {
			loadContent();
		}
	});

	function getNodeTypeBadgeColor(type: string): string {
		switch (type) {
			case 'PROMPT': return 'bg-blue-100 text-blue-700';
			case 'INPUT': return 'bg-purple-100 text-purple-700';
			case 'GENERATED': return 'bg-green-100 text-green-700';
			case 'VFS': return 'bg-orange-100 text-orange-700';
			default: return 'bg-gray-100 text-gray-700';
		}
	}

	// Get file paths from VFS node detail
	let vfsFilePaths = $derived(nodeDetail?.files?.map(f => f.filepath) ?? []);
</script>

<div 
	class="rounded-lg border border-gray-200 bg-gray-50 p-4 transition-all hover:border-gray-300"
>
	<div 
		class="flex items-start gap-3 cursor-pointer"
		onclick={() => expanded = !expanded}
		onkeydown={(e) => e.key === 'Enter' && (expanded = !expanded)}
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
				{#if node.external}
					<span class="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
						External
					</span>
				{/if}
			</div>
			
			<p class="text-xs text-gray-500 mt-1 font-mono truncate">
				ID: {node.id.substring(0, 8)}...
			</p>
			
			{#if node.external && node.externalArtifactId}
				<p class="text-xs text-gray-500 mt-1">
					References artifact: {node.externalArtifactId.substring(0, 8)}...
				</p>
			{/if}
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
			{#if node.type === 'VFS'}
				{#if loadingContent}
					<div class="flex items-center gap-2 text-sm text-gray-500">
						<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
						Loading files...
					</div>
				{:else if vfsFilePaths.length > 0}
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
			{:else if node.external}
				<p class="text-sm text-gray-600">
					This is an external reference to another artifact's node.
				</p>
				{#if node.externalArtifactId}
					<a 
						href="/artifact/{node.externalArtifactId}" 
						class="inline-flex items-center gap-1 mt-2 text-sm text-[#0969da] hover:underline"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
						</svg>
						View source artifact
					</a>
				{/if}
			{:else if loadingContent}
				<div class="flex items-center gap-2 text-sm text-gray-500">
					<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
					Loading content...
				</div>
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
