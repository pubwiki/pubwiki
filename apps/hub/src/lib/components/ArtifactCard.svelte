<script lang="ts">
	import type { ArtifactLineageItem, ArtifactListItem } from '@pubwiki/api';

	type Props = {
		/** Pass either a lineageItem or artifact directly */
		lineageItem?: ArtifactLineageItem;
		artifact?: ArtifactListItem;
		/** Display size variant */
		size?: 'sm' | 'md';
	};

	let { 
		lineageItem, 
		artifact: directArtifact, 
		size = 'md',
	}: Props = $props();

	// Normalize artifact data: ArtifactLineageItem has artifactId, ArtifactListItem has id
	let artifactId = $derived(lineageItem?.artifactId ?? directArtifact?.id);
	let artifactName = $derived(lineageItem?.name ?? directArtifact?.name);
	let thumbnailUrl = $derived(lineageItem?.thumbnailUrl ?? directArtifact?.thumbnailUrl);
	let author = $derived(lineageItem?.author ?? directArtifact?.author);
	let description = $derived((directArtifact as ArtifactListItem | undefined)?.description);

	// Size-dependent classes
	let imgSize = $derived(size === 'sm' ? 'w-12 h-12' : 'w-16 h-16');
	let imgPlaceholder = $derived(size === 'sm' ? '48x48' : '64x64');
	let titleSize = $derived(size === 'sm' ? 'text-xs' : 'text-sm');
	let subtitleSize = $derived(size === 'sm' ? 'text-[10px]' : 'text-xs');
	let gap = $derived(size === 'sm' ? 'gap-2' : 'gap-3');
	let padding = $derived(size === 'sm' ? 'p-2' : '');
</script>

<div class="flex {gap} group {padding}">
	<a href="/artifact/{artifactId}" class="{imgSize} rounded-lg overflow-hidden shrink-0 border border-gray-100 shadow-sm">
		<img 
			src={thumbnailUrl || `https://placehold.co/${imgPlaceholder}/e5e7eb/9ca3af?text=?`} 
			alt={artifactName} 
			class="w-full h-full object-cover group-hover:opacity-90 transition" 
		/>
	</a>
	<div class="flex-1 min-w-0">
		<a href="/artifact/{artifactId}">
			<h4 class="{titleSize} font-bold text-gray-800 group-hover:text-gray-600 truncate transition-colors">{artifactName}</h4>
		</a>
		<a 
			href="/user/{author?.id}" 
			class="{subtitleSize} text-gray-500 hover:text-gray-700 hover:underline truncate block transition-colors"
		>
			by {author?.displayName || author?.username || 'Unknown'}
		</a>
		{#if description && size === 'md'}
			<p class="text-xs text-gray-400 line-clamp-1 mt-0.5">{description}</p>
		{/if}
	</div>
</div>
