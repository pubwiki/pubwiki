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

	// Size-dependent classes
	let imgSize = $derived(size === 'sm' ? 'w-12 h-12' : 'w-16 h-16');
	let imgPlaceholder = $derived(size === 'sm' ? '48x48' : '64x64');
	let titleSize = $derived(size === 'sm' ? 'text-xs' : 'text-sm');
	let subtitleSize = $derived(size === 'sm' ? 'text-[10px]' : 'text-xs');
	let badgeSize = $derived(size === 'sm' ? 'text-[10px] px-1 py-0.5' : 'text-xs px-1.5 py-0.5');
	let gap = $derived(size === 'sm' ? 'gap-2' : 'gap-3');
	let padding = $derived(size === 'sm' ? 'p-2' : '');
</script>

<a href="/artifact/{artifactId}" class="flex {gap} group {padding}">
	<div class="{imgSize} rounded overflow-hidden shrink-0 border border-gray-200">
		<img 
			src={thumbnailUrl || `https://placehold.co/${imgPlaceholder}/222/fff?text=?`} 
			alt={artifactName} 
			class="w-full h-full object-cover group-hover:opacity-80 transition" 
		/>
	</div>
	<div class="flex-1 min-w-0">
		<h4 class="{titleSize} font-bold text-gray-900 group-hover:text-[#0969da] truncate">{artifactName}</h4>
		<p class="{subtitleSize} text-gray-500 truncate">by {author?.displayName || author?.username || 'Unknown'}</p>
	</div>
</a>
