<script lang="ts">
	import '../app.css';
	import Header from '$lib/components/Header.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<meta name="robots" content="index, follow" />
</svelte:head>

<div class="min-h-screen flex flex-col">
	<Header />
	<div class="flex-1">
		{@render children()}
	</div>
</div>
