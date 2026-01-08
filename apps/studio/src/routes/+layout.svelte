<script lang="ts">
	import '@tailwindcss/typography';
	import '../app.css';
	import { createAuth, createSettingsStore } from '@pubwiki/ui/stores';
	import { API_BASE_URL } from '$lib/config';

	let { children } = $props();

	// Initialize global stores
	createAuth(API_BASE_URL);
	createSettingsStore();
</script>

<div class="h-screen w-full">
	{@render children()}
</div>
