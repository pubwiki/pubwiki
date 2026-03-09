<script lang="ts">
	import '../app.css';
	import { createAuth, createSettingsStore } from '@pubwiki/ui/stores';
	import { API_BASE_URL } from '$lib/config';

	let { children } = $props();

	createAuth(API_BASE_URL);
	createSettingsStore();
</script>

{@render children()}
