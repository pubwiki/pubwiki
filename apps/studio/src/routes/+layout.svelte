<script lang="ts">
	import '@tailwindcss/typography';
	import '../app.css';
	import { createAuth, createSettingsStore } from '@pubwiki/ui/stores';
	import { API_BASE_URL } from '$lib/config';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	// Initialize global stores
	createAuth(API_BASE_URL);
	createSettingsStore();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
</svelte:head>

<div class="h-screen w-full">
	{@render children()}
</div>
