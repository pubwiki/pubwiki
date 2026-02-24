<script lang="ts">
	import type { ArtifactListItem } from '@pubwiki/api';

	let { artifact } = $props<{ artifact: ArtifactListItem }>();
</script>

<div class="flex gap-3 group">
	<a href="/artifact/{artifact.id}" class="w-16 h-16 rounded-lg overflow-hidden shrink-0 border border-gray-100 shadow-sm">
		<img 
			src={artifact.thumbnailUrl || 'https://placehold.co/64x64/e5e7eb/9ca3af?text=?'} 
			alt={artifact.name} 
			class="w-full h-full object-cover group-hover:opacity-90 transition" 
		/>
	</a>
	<div class="flex-1 min-w-0">
		<a href="/artifact/{artifact.id}">
			<h4 class="text-sm font-bold text-gray-800 group-hover:text-gray-600 truncate transition-colors">{artifact.name}</h4>
		</a>
		<a 
			href="/user/{artifact.author.id}" 
			class="text-xs text-gray-500 hover:text-gray-700 hover:underline truncate block transition-colors"
		>
			by {artifact.author.displayName || artifact.author.username}
		</a>
		<div class="flex items-center gap-2 mt-1 text-xs text-gray-400">
			<span class="flex items-center gap-0.5 text-rose-400">
				<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> 
				{artifact.stats?.favCount ?? 0}
			</span>
			<span class="text-gray-300">|</span>
			<span>{artifact.type}</span>
		</div>
	</div>
</div>
