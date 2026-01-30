<script lang="ts">
	import { onMount } from 'svelte';

	let container: HTMLElement;

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						entry.target.classList.add('revealed');
					}
				});
			},
			{ threshold: 0.1 }
		);

		container.querySelectorAll('.reveal').forEach((el) => observer.observe(el));

		return () => observer.disconnect();
	});
</script>

<section class="py-24 relative overflow-hidden" bind:this={container}>
	<!-- Background -->
	<div class="absolute inset-0 bg-gradient-to-br from-[#0d1117] via-[#161b22] to-[#0d1117]"></div>

	<!-- Decorative elements -->
	<div class="absolute top-0 left-0 w-full h-full overflow-hidden">
		<div class="absolute top-20 left-10 w-96 h-96 bg-purple-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-float"></div>
		<div class="absolute bottom-20 right-10 w-96 h-96 bg-pink-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-float" style="animation-delay: 1s"></div>
		<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600 rounded-full mix-blend-multiply filter blur-3xl opacity-10 animate-float" style="animation-delay: 2s"></div>
	</div>

	<!-- Grid pattern overlay -->
	<div class="absolute inset-0 opacity-5">
		<svg class="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
			<defs>
				<pattern id="cta-grid" width="4" height="4" patternUnits="userSpaceOnUse">
					<path d="M 4 0 L 0 0 0 4" fill="none" stroke="white" stroke-width="0.1" />
				</pattern>
			</defs>
			<rect width="100" height="100" fill="url(#cta-grid)" />
		</svg>
	</div>

	<div class="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
		<div class="reveal">
			<!-- Badge -->
			<div class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 backdrop-blur-sm text-white/80 text-sm font-medium mb-8">
				<span class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></span>
				Open Source & Free Forever
			</div>

			<!-- Heading -->
			<h2 class="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-6">
				Start Creating
				<span class="block mt-2 bg-gradient-to-r from-purple-400 via-pink-400 to-purple-400 bg-clip-text text-transparent animate-gradient">
					Your AI Story Today
				</span>
			</h2>

			<!-- Description -->
			<p class="text-lg sm:text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
				Join thousands of creators building the next generation of interactive fiction.
				No credit card required. No limits on creativity.
			</p>

			<!-- CTA Buttons -->
			<div class="flex flex-col sm:flex-row gap-4 justify-center">
				<a
					href="https://studio.pub.wiki"
					class="inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-white rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 transition-all shadow-2xl shadow-purple-500/25 hover:shadow-purple-500/40 hover:-translate-y-0.5"
				>
					<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
					</svg>
					Launch Studio
				</a>
				<a
					href="https://github.com/pubwiki"
					target="_blank"
					rel="noopener"
					class="inline-flex items-center justify-center gap-2 px-8 py-4 text-lg font-semibold text-white rounded-xl border-2 border-white/20 hover:border-white/40 hover:bg-white/5 transition-all"
				>
					<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
						<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
					</svg>
					View on GitHub
				</a>
			</div>

			<!-- Trust indicators -->
			<div class="mt-16 flex flex-wrap items-center justify-center gap-8 text-gray-500 text-sm">
				<div class="flex items-center gap-2">
					<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					<span>No credit card</span>
				</div>
				<div class="flex items-center gap-2">
					<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					<span>Open source</span>
				</div>
				<div class="flex items-center gap-2">
					<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					<span>Self-hostable</span>
				</div>
				<div class="flex items-center gap-2">
					<svg class="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
					</svg>
					<span>Bring your own API key</span>
				</div>
			</div>
		</div>
	</div>
</section>
