<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} type="image/svg+xml" />
	<title>Pub.Wiki - AI Roleplay Creation Platform</title>
	<meta
		name="description"
		content="Create, share, and play AI-powered interactive stories. The ultimate platform for AI roleplay creators and players."
	/>
	<meta name="keywords" content="AI roleplay, interactive fiction, AI games, prompt engineering, AI storytelling" />
	<meta property="og:title" content="Pub.Wiki - AI Roleplay Creation Platform" />
	<meta
		property="og:description"
		content="Create, share, and play AI-powered interactive stories."
	/>
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{@render children()}
