<script lang="ts">
	import { onMount } from 'svelte';

	interface Step {
		number: string;
		title: string;
		description: string;
		icon: string;
		color: string;
	}

	const steps: Step[] = [
		{
			number: '01',
			title: 'Design Your Prompts',
			description:
				'Create character personalities, world settings, and story beats using our visual prompt editor. Use #hashtags to create dynamic input slots.',
			icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
			color: '#3b82f6'
		},
		{
			number: '02',
			title: 'Connect the Flow',
			description:
				'Link prompts, inputs, and AI responses together. Add game logic with Lua scripts, file storage with VFS, and preview in the sandbox.',
			icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
			color: '#8b5cf6'
		},
		{
			number: '03',
			title: 'Publish & Share',
			description:
				'Hit publish to share your creation with the community. Others can play, star, fork, and remix your work—building on your creativity.',
			icon: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
			color: '#22c55e'
		}
	];

	let container: HTMLElement;
	let activeStep = $state(0);

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

		// Auto-rotate steps
		const interval = setInterval(() => {
			activeStep = (activeStep + 1) % steps.length;
		}, 4000);

		return () => {
			observer.disconnect();
			clearInterval(interval);
		};
	});
</script>

<section id="how-it-works" class="py-24 bg-gradient-to-b from-[#f6f8fa] to-white" bind:this={container}>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<!-- Section Header -->
		<div class="text-center mb-16 reveal">
			<div
				class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-sm font-medium mb-4"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M13 10V3L4 14h7v7l9-11h-7z"
					/>
				</svg>
				Simple Workflow
			</div>
			<h2 class="text-3xl sm:text-4xl font-bold text-[#24292f] mb-4">How It Works</h2>
			<p class="text-lg text-[#57606a] max-w-2xl mx-auto">
				From idea to published artifact in three simple steps. No coding experience required.
			</p>
		</div>

		<div class="grid lg:grid-cols-2 gap-16 items-center">
			<!-- Steps List -->
			<div class="space-y-6">
				{#each steps as step, i}
					<button
						class="reveal reveal-delay-{i + 1} w-full text-left p-6 rounded-2xl transition-all duration-300 {activeStep === i
							? 'bg-white shadow-xl border-2'
							: 'bg-transparent hover:bg-white/50'}"
						style={activeStep === i ? `border-color: ${step.color}` : ''}
						onclick={() => (activeStep = i)}
					>
						<div class="flex items-start gap-4">
							<!-- Step Number -->
							<div
								class="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg shrink-0 transition-all duration-300"
								style={activeStep === i
									? `background: ${step.color}; color: white`
									: 'background: #f6f8fa; color: #57606a'}
							>
								{step.number}
							</div>

							<div class="flex-1">
								<h3 class="text-lg font-semibold text-[#24292f] mb-2">{step.title}</h3>
								<p
									class="text-sm text-[#57606a] transition-all duration-300 {activeStep === i
										? 'max-h-40 opacity-100'
										: 'max-h-0 opacity-0 overflow-hidden lg:max-h-40 lg:opacity-100'}"
								>
									{step.description}
								</p>
							</div>

							<!-- Arrow indicator -->
							<svg
								class="w-5 h-5 text-gray-400 shrink-0 transition-transform duration-300 {activeStep === i ? 'rotate-90' : ''}"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
							</svg>
						</div>
					</button>
				{/each}
			</div>

			<!-- Visual Demo -->
			<div class="reveal relative">
				<div class="relative aspect-square max-w-lg mx-auto">
					<!-- Background decoration -->
					<div
						class="absolute inset-0 rounded-3xl transition-all duration-500"
						style="background: linear-gradient(135deg, {steps[activeStep].color}20, {steps[activeStep].color}05)"
					></div>

					<!-- Step illustration -->
					<div class="absolute inset-8 flex items-center justify-center">
						{#if activeStep === 0}
							<!-- Design illustration -->
							<div class="text-center">
								<div class="relative">
									<!-- Mock node editor -->
									<div class="bg-white rounded-2xl shadow-2xl p-6 max-w-sm mx-auto border border-gray-100">
										<div class="flex items-center gap-2 mb-4">
											<div class="w-3 h-3 rounded-full bg-red-400"></div>
											<div class="w-3 h-3 rounded-full bg-yellow-400"></div>
											<div class="w-3 h-3 rounded-full bg-green-400"></div>
											<span class="text-xs text-gray-400 ml-2">prompt-editor.pwk</span>
										</div>
										<div class="space-y-3">
											<div class="bg-blue-50 border border-blue-200 rounded-lg p-3">
												<div class="text-xs font-medium text-blue-600 mb-1">Character Prompt</div>
												<div class="text-sm text-gray-600">You are <span class="bg-purple-100 text-purple-600 px-1 rounded">#character</span>, a brave adventurer...</div>
											</div>
											<div class="bg-purple-50 border border-purple-200 rounded-lg p-3">
												<div class="text-xs font-medium text-purple-600 mb-1">Setting</div>
												<div class="text-sm text-gray-600">In a mystical <span class="bg-purple-100 text-purple-600 px-1 rounded">#world</span>...</div>
											</div>
										</div>
									</div>
									<!-- Floating elements -->
									<div class="absolute -top-4 -right-4 bg-blue-500 text-white text-xs px-2 py-1 rounded-full shadow-lg animate-float">
										#hashtag
									</div>
								</div>
							</div>
						{:else if activeStep === 1}
							<!-- Connect illustration -->
							<div class="text-center">
								<svg viewBox="0 0 300 200" class="w-full max-w-sm mx-auto">
									<!-- Nodes -->
									<g class="animate-fade-in-up" style="animation-delay: 0s">
										<rect x="20" y="40" width="80" height="40" rx="8" fill="white" stroke="#3b82f6" stroke-width="2" />
										<rect x="20" y="40" width="80" height="12" rx="8" fill="#3b82f6" />
										<rect x="20" y="48" width="80" height="4" fill="#3b82f6" />
										<text x="60" y="68" text-anchor="middle" font-size="10" fill="#24292f">Prompt</text>
									</g>
									<g class="animate-fade-in-up" style="animation-delay: 0.2s">
										<rect x="20" y="120" width="80" height="40" rx="8" fill="white" stroke="#8b5cf6" stroke-width="2" />
										<rect x="20" y="120" width="80" height="12" rx="8" fill="#8b5cf6" />
										<rect x="20" y="128" width="80" height="4" fill="#8b5cf6" />
										<text x="60" y="148" text-anchor="middle" font-size="10" fill="#24292f">Input</text>
									</g>
									<g class="animate-fade-in-up" style="animation-delay: 0.4s">
										<rect x="180" y="80" width="100" height="40" rx="8" fill="white" stroke="#22c55e" stroke-width="2" />
										<rect x="180" y="80" width="100" height="12" rx="8" fill="#22c55e" />
										<rect x="180" y="88" width="100" height="4" fill="#22c55e" />
										<text x="230" y="108" text-anchor="middle" font-size="10" fill="#24292f">AI Response</text>
									</g>
									<!-- Connections -->
									<path d="M100 60 C140 60, 140 100, 180 100" fill="none" stroke="#d0d7de" stroke-width="2" stroke-dasharray="4,4" class="animate-draw-line" />
									<path d="M100 140 C140 140, 140 100, 180 100" fill="none" stroke="#d0d7de" stroke-width="2" stroke-dasharray="4,4" class="animate-draw-line" style="animation-delay: 0.3s" />
									<!-- Animated particles -->
									<circle r="4" fill="#8b5cf6">
										<animateMotion dur="2s" repeatCount="indefinite">
											<mpath href="#conn1" />
										</animateMotion>
									</circle>
									<path id="conn1" d="M100 60 C140 60, 140 100, 180 100" fill="none" />
								</svg>
							</div>
						{:else}
							<!-- Publish illustration -->
							<div class="text-center">
								<div class="bg-white rounded-2xl shadow-2xl p-6 max-w-xs mx-auto border border-gray-100">
									<div class="flex items-center gap-3 mb-4">
										<div class="w-12 h-12 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
											<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
											</svg>
										</div>
										<div>
											<div class="font-semibold text-[#24292f]">My Adventure</div>
											<div class="text-xs text-[#57606a]">by @creator</div>
										</div>
									</div>
									<div class="flex items-center justify-between text-sm text-[#57606a] mb-4">
										<span class="flex items-center gap-1">
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
											</svg>
											248
										</span>
										<span class="flex items-center gap-1">
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
											</svg>
											42 forks
										</span>
									</div>
									<button class="w-full py-2 rounded-lg bg-gradient-to-r from-green-500 to-emerald-500 text-white font-medium text-sm hover:opacity-90 transition">
										✓ Published
									</button>
								</div>
								<!-- Floating badges -->
								<div class="absolute top-10 right-10 bg-yellow-400 text-yellow-900 text-xs px-2 py-1 rounded-full shadow-lg animate-float">
									⭐ Featured
								</div>
								<div class="absolute bottom-20 left-10 bg-green-400 text-green-900 text-xs px-2 py-1 rounded-full shadow-lg animate-float" style="animation-delay: 0.5s">
									📈 Trending
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	@keyframes draw-line {
		from {
			stroke-dashoffset: 100;
		}
		to {
			stroke-dashoffset: 0;
		}
	}

	.animate-draw-line {
		animation: draw-line 1s ease-out forwards;
	}
</style>
