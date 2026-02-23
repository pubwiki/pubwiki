<script lang="ts">
	import type { ArtifactListItem } from '@pubwiki/api';

	let { artifact } = $props<{ artifact: ArtifactListItem }>();
</script>

<a href="/artifact/{artifact.id}" class="flex gap-3 group">
	<div class="w-16 h-16 rounded overflow-hidden shrink-0 border border-gray-200">
		<img 
			src={artifact.thumbnailUrl || 'https://placehold.co/64x64/222/fff?text=?'} 
			alt={artifact.name} 
			class="w-full h-full object-cover group-hover:opacity-80 transition" 
		/>
	</div>
	<div class="flex-1 min-w-0">
		<h4 class="text-sm font-bold text-gray-900 group-hover:text-[#0969da] truncate">{artifact.name}</h4>
		<p class="text-xs text-gray-500 truncate">by {artifact.author.displayName || artifact.author.username}</p>
		<div class="flex items-center gap-2 mt-1 text-xs text-gray-400">
			<span class="flex items-center gap-0.5">
				<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> 
				{artifact.stats?.favCount ?? 0}
			</span>
			<span>{artifact.type}</span>
		</div>
	</div>
</a>
