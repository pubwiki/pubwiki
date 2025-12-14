<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>AI Game Hub</title>
	<meta name="description" content="Discover AI-generated games" />
</svelte:head>

<div class="min-h-screen flex flex-col font-sans bg-[#f6f8fa] text-[#24292f]">
	<!-- Header -->
	<header class="bg-white border-b border-gray-200 py-3">
		<div class="mx-auto max-w-[1200px] px-4 flex items-center gap-6">
			<!-- Logo -->
			<a href="/" class="flex items-center gap-2 font-bold text-lg text-[#24292f] hover:text-[#0969da] transition">
				<svg class="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
					<path d="M12 2L2 7l10 5 10-5-10-5zm0 9l2.5-1.25L12 8.5l-2.5 1.25L12 11zm0 2.5l-5-2.5-5 2.5L12 22l10-8.5-5-2.5-5 2.5z"/>
				</svg>
				<span>Pub.Wiki</span>
			</a>

			<!-- Navigation Links (Left Aligned) -->
			<nav class="flex items-center gap-6 text-sm font-semibold text-[#24292f]">
				<a href="/" class="hover:text-[#0969da] transition">Hub</a>
				<a href="/community" class="hover:text-[#0969da] transition">COMMUNITY</a>
				<a href="/about" class="hover:text-[#0969da] transition">ABOUT</a>
				<a href="/support" class="hover:text-[#0969da] transition">SUPPORT</a>
			</nav>

			<!-- Spacer -->
			<div class="flex-1"></div>

			<!-- User Actions -->
			<div class="flex items-center gap-3 text-sm text-[#24292f]">
				<button class="bg-[#000000] hover:bg-[#2c974b] px-3 py-1 rounded text-xs font-bold text-white border border-transparent">
					LAUNCH APP
				</button>
				<a href="/login" class="hover:text-[#0969da]">login</a>
				<span>|</span>
				<a href="/register" class="hover:text-[#0969da]">register</a>
			</div>
		</div>
	</header>

	<!-- Main Content -->
	<main class="flex-1">
		{@render children()}
	</main>

	<!-- Footer -->
	<footer class="bg-white text-gray-500 py-12 text-sm border-t border-gray-200">
		<div class="mx-auto max-w-[1200px] px-4">
			<div class="grid grid-cols-1 md:grid-cols-4 gap-8">
				<div class="col-span-2">
					<h3 class="text-gray-900 font-bold mb-4 text-lg">AI Game Hub</h3>
					<p class="mb-4 text-xs">© 2025 AI Game Hub Corporation. All rights reserved. All trademarks are property of their respective owners in the US and other countries.</p>
				</div>
				<div>
					<h3 class="text-gray-900 font-bold mb-2">Resources</h3>
					<ul class="space-y-1 text-xs">
						<li><a href="/" class="hover:text-[#0969da]">Documentation</a></li>
						<li><a href="/" class="hover:text-[#0969da]">API</a></li>
					</ul>
				</div>
				<div>
					<h3 class="text-gray-900 font-bold mb-2">Company</h3>
					<ul class="space-y-1 text-xs">
						<li><a href="/" class="hover:text-[#0969da]">About</a></li>
						<li><a href="/" class="hover:text-[#0969da]">Jobs</a></li>
					</ul>
				</div>
			</div>
		</div>
	</footer>
</div>
