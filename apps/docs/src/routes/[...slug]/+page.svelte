<script lang="ts">
	import type { PageData } from './$types';
	import DocLayout from '$lib/components/DocLayout.svelte';

	let { data }: { data: PageData } = $props();

	let Content = $derived(data.content);
	let title = $derived(data.metadata?.title as string | undefined);
	let description = $derived(data.metadata?.description as string | undefined);
</script>

<svelte:head>
	<title>{title ? `${title} | Pub.Wiki Docs` : 'Pub.Wiki Docs'}</title>
	{#if description}
		<meta name="description" content={description} />
	{/if}
</svelte:head>

<DocLayout {title} {description}>
	<Content />
</DocLayout>
