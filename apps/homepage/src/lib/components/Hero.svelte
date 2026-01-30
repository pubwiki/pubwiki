<script lang="ts">
	import NodeGraph from './NodeGraph.svelte';
</script>

<section class="relative min-h-screen flex items-center overflow-hidden pt-16">
	<!-- Background Gradient -->
	<div
		class="absolute inset-0 bg-gradient-to-br from-[#f6f8fa] via-white to-[#f0f4ff] -z-10"
	></div>

	<!-- Decorative Elements -->
	<div class="absolute top-20 left-10 w-72 h-72 bg-purple-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-float"></div>
	<div class="absolute top-40 right-20 w-72 h-72 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-float" style="animation-delay: 1s;"></div>
	<div class="absolute bottom-20 left-1/3 w-72 h-72 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-float" style="animation-delay: 2s;"></div>

	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
		<div class="grid lg:grid-cols-2 gap-12 items-center">
			<!-- Left: Text Content -->
			<div class="text-center lg:text-left">
				<div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-100 text-purple-700 text-sm font-medium mb-6">
					<span class="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></span>
					AI-Powered Interactive Fiction
				</div>

				<h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
					<span class="block text-[#24292f]">Create AI Stories</span>
					<span class="block gradient-text">That Come to Life</span>
				</h1>

				<p class="text-lg sm:text-xl text-[#57606a] mb-8 max-w-xl mx-auto lg:mx-0">
					Build immersive AI roleplay experiences with our visual node editor. No coding required.
					Share your creations and let others play, fork, and remix.
				</p>

				<div class="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
					<a
						href="https://studio.pub.wiki"
						class="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-white rounded-xl bg-gradient-to-r from-[#8b5cf6] to-[#ec4899] hover:opacity-90 transition-all shadow-xl shadow-purple-500/25 hover:shadow-purple-500/40 hover:-translate-y-0.5"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M13 10V3L4 14h7v7l9-11h-7z"
							/>
						</svg>
						Start Creating — It's Free
					</a>
					<a
						href="https://hub.pub.wiki"
						class="inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-[#24292f] rounded-xl border-2 border-gray-200 bg-white hover:border-[#0969da] hover:text-[#0969da] transition-all"
					>
						<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
							/>
						</svg>
						Explore Hub
					</a>
				</div>

				<!-- Stats -->
				<div class="mt-12 flex items-center justify-center lg:justify-start gap-8">
					<div class="text-center">
						<div class="text-2xl font-bold text-[#24292f]">1000+</div>
						<div class="text-sm text-[#57606a]">Creators</div>
					</div>
					<div class="w-px h-10 bg-gray-200"></div>
					<div class="text-center">
						<div class="text-2xl font-bold text-[#24292f]">5000+</div>
						<div class="text-sm text-[#57606a]">Artifacts</div>
					</div>
					<div class="w-px h-10 bg-gray-200"></div>
					<div class="text-center">
						<div class="text-2xl font-bold text-[#24292f]">Open</div>
						<div class="text-sm text-[#57606a]">Source</div>
					</div>
				</div>
			</div>

			<!-- Right: Visual Demo -->
			<div class="relative">
				<NodeGraph />
			</div>
		</div>
	</div>

	<!-- Scroll Indicator -->
	<div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
		<svg class="w-6 h-6 text-[#57606a]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
		</svg>
	</div>
</section>
