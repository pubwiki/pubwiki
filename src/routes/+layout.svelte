<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { createAuth } from '$lib/stores/auth.svelte';
	import { createArtifactStore } from '$lib/stores/artifacts.svelte';
	import { createProjectStore } from '$lib/stores/projects.svelte';

	let { children } = $props();

	const auth = createAuth();
	const artifactStore = createArtifactStore();
	const projectStore = createProjectStore();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AI Game Hub</title>
	<meta name="description" content="Discover AI-generated games" />
</svelte:head>

{@render children()}
