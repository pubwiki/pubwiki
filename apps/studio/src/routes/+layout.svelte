<script lang="ts">
	import '@tailwindcss/typography';
	import '../app.css';
	import { createAuth, createSettingsStore } from '@pubwiki/ui/stores';
	import { ToastContainer } from '@pubwiki/ui/components';
	import { API_BASE_URL } from '$lib/config';
	import favicon from '$lib/assets/favicon.svg';
	import { initGlobalErrorHandler } from '$lib/errors';

	let { children } = $props();

	// Initialize global stores
	createAuth(API_BASE_URL);
	createSettingsStore();

	// Initialize global error handling
	initGlobalErrorHandler();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
</svelte:head>

<div class="h-screen w-full">
	{@render children()}
</div>

<ToastContainer />
