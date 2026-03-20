<script lang="ts">
	import type { ArtifactLineageItem, ArtifactListItem } from '@pubwiki/api';
	import { ArtifactCard as BaseArtifactCard } from '@pubwiki/ui/components';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	type Props = {
		/** Pass either a lineageItem or artifact directly */
		lineageItem?: ArtifactLineageItem;
		artifact?: ArtifactListItem;
		/** Card variant */
		variant?: 'marketplace' | 'compact';
	};

	let { 
		lineageItem, 
		artifact: directArtifact, 
		variant = 'compact',
	}: Props = $props();

	// Normalize artifact data: ArtifactLineageItem has artifactId, ArtifactListItem has id
	let artifactId = $derived(lineageItem?.artifactId ?? directArtifact?.id);
	let artifactName = $derived(lineageItem?.name ?? directArtifact?.name ?? '');
	let thumbnailUrl = $derived(lineageItem?.thumbnailUrl ?? directArtifact?.thumbnailUrl);
	let author = $derived(lineageItem?.author ?? directArtifact?.author);
	let authorName = $derived(author?.displayName || author?.username || 'Unknown');
	let description = $derived((directArtifact as ArtifactListItem | undefined)?.description);
	let tags = $derived((directArtifact as ArtifactListItem | undefined)?.tags?.map(t => t.name) ?? []);
	let stats = $derived((directArtifact as ArtifactListItem | undefined)?.stats);
</script>

<BaseArtifactCard
	name={artifactName}
	{thumbnailUrl}
	{authorName}
	{description}
	{tags}
	{variant}
	stats={stats ? { viewCount: stats.viewCount, favCount: stats.favCount } : undefined}
	onclick={() => { if (artifactId) goto(resolve(`/artifact/${artifactId}`)); }}
	onclickAuthor={() => { if (author?.id) goto(resolve(`/user/${author.id}`)); }}
/>
