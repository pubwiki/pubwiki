<script lang="ts">
	import { page } from '$app/state';
	import { locales, localizeHref, getLocale, setLocale } from '$lib/paraglide/runtime';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { createAuth } from '$lib/stores/auth.svelte';
	import { createArtifactStore } from '$lib/stores/artifacts.svelte';
	import { createProjectStore } from '$lib/stores/projects.svelte';
	import { createSettingsStore } from '$lib/stores/settings.svelte';
	import { onMount } from 'svelte';

	let { children } = $props();
	const auth = createAuth();
	const artifactStore = createArtifactStore();
	const projectStore = createProjectStore();
	const settings = createSettingsStore();

	// Initialize locale on client and update HTML lang attribute
	onMount(() => {
		const locale = getLocale();
		document.documentElement.lang = locale;
	});

	// Function to change locale
	function changeLocale(newLocale: 'en' | 'zh') {
		setLocale(newLocale, { reload: false });
		document.documentElement.lang = newLocale;
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Pub.Wiki</title>
	<meta name="description" content="The platform for participatory culture" />
</svelte:head>

{@render children()}
<div style="display:none">
	{#each locales as locale}
		<a href={localizeHref(page.url.pathname, { locale })}>
			{locale}
		</a>
	{/each}
</div>
