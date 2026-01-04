<script lang="ts">
	import type { ArtifactLineageItem } from '$lib/types';
	import ArtifactCard from './ArtifactCard.svelte';

	let { lineageItem } = $props<{ lineageItem: ArtifactLineageItem }>();
</script>

<ArtifactCard {lineageItem} size="md" />
