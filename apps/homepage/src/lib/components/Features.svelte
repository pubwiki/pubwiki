<script lang="ts">
	import { onMount } from 'svelte';

	interface PlayerFeature {
		id: string;
		title: string;
		tagline: string;
		description: string;
		color: string;
	}

	const playerFeatures: PlayerFeature[] = [
		{
			id: 'memory',
			title: 'Long-Term Memory',
			tagline: 'AI That Truly Remembers',
			description: "Your AI companion remembers past conversations, character relationships, and story events. No more repetitive introductions or forgotten plot points.",
			color: '#22c55e'
		},
		{
			id: 'worldstate',
			title: 'World State Engine',
			tagline: 'Living, Breathing Worlds',
			description: 'Track inventory, relationships, time progression, and custom variables. The world responds to your choices and evolves with your story.',
			color: '#06b6d4'
		},
		{
			id: 'gamesaves',
			title: 'Cloud Gamesaves',
			tagline: 'Your Progress, Safely Stored',
			description: 'Create game checkpoints anytime. Your saves sync securely to the cloud—resume your adventure on any device, never lose your progress again.',
			color: '#8b5cf6'
		},
		{
			id: 'writing',
			title: 'Seamless Writing',
			tagline: 'From Play to Publication',
			description: 'Transform your roleplay sessions into polished stories. Export your gameplay history as beautifully formatted novels to share with the world.',
			color: '#f59e0b'
		}
	];

	let container: HTMLElement;
	let activeFeature = $state(0);
	let isHovering = $state(false);
	let intervalId: ReturnType<typeof setInterval> | null = null;

	function startAutoRotate() {
		if (intervalId) clearInterval(intervalId);
		intervalId = setInterval(() => {
			if (!isHovering) {
				activeFeature = (activeFeature + 1) % playerFeatures.length;
			}
		}, 5000);
	}

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

		// Start auto-rotate
		startAutoRotate();

		return () => {
			observer.disconnect();
			if (intervalId) clearInterval(intervalId);
		};
	});

	function handleFeatureHover(index: number) {
		isHovering = true;
		activeFeature = index;
	}

	function handleFeatureLeave() {
		isHovering = false;
	}
</script>

<section id="features" class="py-24 bg-white" bind:this={container}>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<!-- Section Header -->
		<div class="text-center mb-16 reveal">
			<h2 class="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
				AI Roleplay, Evolved
			</h2>
			<p class="text-lg text-slate-600 max-w-2xl mx-auto">
				Tired of AI forgetting your story? Frustrated by limited world-building? 
				We built what every roleplayer deserves.
			</p>
		</div>

		<!-- Main Content: Features + Interactive Demo -->
		<div class="grid lg:grid-cols-2 gap-12 items-stretch">
			<!-- Left: Feature List -->
			<div class="space-y-1 reveal flex flex-col justify-between">
				{#each playerFeatures as feature, i}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="w-full text-left px-5 py-5 rounded-xl transition-all duration-300 border-2 cursor-pointer {activeFeature === i
							? 'bg-white shadow-lg'
							: 'bg-transparent border-transparent hover:bg-slate-50'}"
						style={activeFeature === i ? `border-color: ${feature.color}` : ''}
						onmouseenter={() => handleFeatureHover(i)}
						onmouseleave={handleFeatureLeave}
					>
						<div class="flex items-start gap-3">
							<!-- Feature indicator -->
							<div
								class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-all duration-300"
								style={activeFeature === i
									? `background: ${feature.color}; color: white`
									: 'background: #f1f5f9; color: #64748b'}
							>
								{#if feature.id === 'memory'}
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
									</svg>
								{:else if feature.id === 'worldstate'}
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
									</svg>
								{:else if feature.id === 'gamesaves'}
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
									</svg>
								{:else}
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
									</svg>
								{/if}
							</div>

							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<h3 class="text-base font-semibold text-slate-900">{feature.title}</h3>
								</div>
								<p class="text-xs font-medium mb-1" style="color: {feature.color}">{feature.tagline}</p>
								<p
									class="text-xs text-slate-600 leading-relaxed transition-all duration-300 {activeFeature === i
										? 'max-h-16 opacity-100'
										: 'max-h-0 opacity-0 overflow-hidden'}"
								>
									{feature.description}
								</p>
							</div>

							<!-- Arrow -->
							<svg
								class="w-5 h-5 text-slate-400 shrink-0 transition-transform duration-300 {activeFeature === i ? 'rotate-90' : ''}"
								fill="none"
								stroke="currentColor"
								viewBox="0 0 24 24"
							>
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
							</svg>
						</div>
					</div>
				{/each}
			</div>

			<!-- Right: Interactive Demo Illustration -->
			<div class="reveal relative h-[520px]">
				<div class="absolute inset-0">
					{#if activeFeature === 0}
						<!-- Memory Feature Demo -->
						<div class="relative w-full h-full flex items-center justify-center">
							<!-- Background glow -->
							<div class="absolute inset-0 bg-linear-to-br from-green-500/10 via-emerald-500/5 to-transparent rounded-3xl"></div>
							
							<!-- Memory visualization -->
							<div class="relative w-full max-w-md">
								<!-- Timeline header -->
								<div class="text-center mb-6">
									<div class="inline-flex items-center gap-2 px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium">
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
										</svg>
										Memory Timeline
									</div>
								</div>

								<!-- Memory entries -->
								<div class="space-y-3">
									{#each [
										{ time: '3 days ago', event: 'First meeting with Aria at the Neon Bar', type: 'event' },
										{ time: '2 days ago', event: 'Aria revealed her past as a corp agent', type: 'secret' },
										{ time: 'Yesterday', event: 'Trust level increased to "Ally"', type: 'relationship' },
										{ time: 'Today', event: 'Started the Sector 7 mission together', type: 'event' }
									] as memory, i}
										<div 
											class="flex gap-3 items-start animate-fade-in-up"
											style="animation-delay: {i * 0.1}s"
										>
											<!-- Timeline dot -->
											<div class="flex flex-col items-center">
												<div class="w-3 h-3 rounded-full {memory.type === 'secret' ? 'bg-amber-400' : memory.type === 'relationship' ? 'bg-pink-400' : 'bg-green-400'}"></div>
												{#if i < 3}
													<div class="w-0.5 h-12 bg-slate-200"></div>
												{/if}
											</div>
											<!-- Memory card -->
											<div class="flex-1 bg-white rounded-xl p-3 shadow-md border border-slate-100">
												<div class="text-xs text-slate-400 mb-1">{memory.time}</div>
												<div class="text-sm text-slate-700">{memory.event}</div>
											</div>
										</div>
									{/each}
								</div>

								<!-- Summary -->
								<div class="mt-6 p-4 bg-green-50 rounded-xl border border-green-200">
									<div class="flex items-center gap-2 text-green-700 text-sm font-medium mb-2">
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
										</svg>
										AI Understands Context
									</div>
									<p class="text-xs text-green-600">
										"Based on your history with Aria, she trusts you enough to share intel about the corporation..."
									</p>
								</div>
							</div>
						</div>
					{:else if activeFeature === 1}
						<!-- World State Feature Demo -->
						<div class="relative w-full h-full flex items-center justify-center">
							<!-- Background glow -->
							<div class="absolute inset-0 bg-linear-to-br from-cyan-500/10 via-blue-500/5 to-transparent rounded-3xl"></div>
							
							<!-- World state dashboard -->
							<div class="relative w-full max-w-md">
								<!-- Dashboard header -->
								<div class="bg-white rounded-t-2xl border border-slate-200 border-b-0 px-4 py-3 flex items-center justify-between">
									<div class="flex items-center gap-2">
										<div class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></div>
										<span class="text-sm font-medium text-slate-700">World State</span>
									</div>
									<span class="text-xs text-slate-400">Live</span>
								</div>

								<!-- State panels -->
								<div class="bg-white rounded-b-2xl border border-slate-200 shadow-xl overflow-hidden">
									<!-- Stats row -->
									<div class="grid grid-cols-3 border-b border-slate-100">
										{#each [
											{ label: 'Day', value: '7', icon: '☀️' },
											{ label: 'Credits', value: '2,450', icon: '💰' },
											{ label: 'Reputation', value: 'Neutral', icon: '⭐' }
										] as stat}
											<div class="p-4 text-center border-r border-slate-100 last:border-r-0">
												<div class="text-lg mb-1">{stat.icon}</div>
												<div class="text-lg font-bold text-slate-900">{stat.value}</div>
												<div class="text-xs text-slate-500">{stat.label}</div>
											</div>
										{/each}
									</div>

									<!-- Inventory -->
									<div class="p-4 border-b border-slate-100">
										<div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Inventory</div>
										<div class="flex flex-wrap gap-2">
											{#each ['🔫 Plasma Pistol', '💊 Medkit x3', '🔑 Access Card', '📱 Hacked Datapad'] as item}
												<span class="px-2 py-1 bg-slate-100 rounded text-xs text-slate-600">{item}</span>
											{/each}
										</div>
									</div>

									<!-- Relationships -->
									<div class="p-4">
										<div class="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Relationships</div>
										<div class="space-y-2">
											{#each [
												{ name: 'Aria', relation: 'Ally', level: 78, color: 'bg-pink-400' },
												{ name: 'Corp Security', relation: 'Hostile', level: 15, color: 'bg-red-400' },
												{ name: 'Underground', relation: 'Friendly', level: 62, color: 'bg-green-400' }
											] as rel}
												<div class="flex items-center gap-3">
													<div class="w-20 text-xs text-slate-600">{rel.name}</div>
													<div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
														<div class="{rel.color} h-full rounded-full transition-all duration-500" style="width: {rel.level}%"></div>
													</div>
													<div class="text-xs text-slate-500 w-16 text-right">{rel.relation}</div>
												</div>
											{/each}
										</div>
									</div>
								</div>

								<!-- Update notification -->
								<div class="mt-4 p-3 bg-cyan-50 rounded-xl border border-cyan-200 animate-fade-in-up" style="animation-delay: 0.5s">
									<div class="flex items-start gap-2">
										<div class="w-5 h-5 rounded-full bg-cyan-400 flex items-center justify-center shrink-0">
											<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
											</svg>
										</div>
										<div class="text-xs text-cyan-700">
											<span class="font-medium">State Updated:</span> After helping Aria, Underground faction reputation +10
										</div>
									</div>
								</div>
							</div>
						</div>
					{:else if activeFeature === 2}
						<!-- Cloud Gamesaves Feature Demo -->
						<div class="relative w-full h-full flex items-center justify-center">
							<!-- Background glow -->
							<div class="absolute inset-0 bg-linear-to-br from-purple-500/10 via-violet-500/5 to-transparent rounded-3xl"></div>
							
							<!-- Saves visualization -->
							<div class="relative w-full max-w-md">
								<!-- Header -->
								<div class="text-center mb-6">
									<div class="inline-flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
										</svg>
										Cloud Saves
									</div>
								</div>

								<!-- Save slots -->
								<div class="space-y-3">
									{#each [
										{ name: 'Before the Final Battle', time: '2 hours ago', chapter: 'Chapter 12', synced: true },
										{ name: 'Aria\'s Betrayal', time: 'Yesterday', chapter: 'Chapter 8', synced: true },
										{ name: 'First Meeting', time: '3 days ago', chapter: 'Chapter 1', synced: true }
									] as save, i}
										<div 
											class="bg-white rounded-xl p-4 shadow-md border border-slate-100 animate-fade-in-up"
											style="animation-delay: {i * 0.1}s"
										>
											<div class="flex items-start justify-between gap-4">
												<div class="flex-1">
													<div class="flex items-center gap-2 mb-1">
														<span class="text-sm font-semibold text-slate-900">{save.name}</span>
														{#if save.synced}
															<span class="w-4 h-4 rounded-full bg-green-100 flex items-center justify-center">
																<svg class="w-2.5 h-2.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																	<path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
																</svg>
															</span>
														{/if}
													</div>
													<div class="flex items-center gap-3 text-xs text-slate-500">
														<span>{save.chapter}</span>
														<span>•</span>
														<span>{save.time}</span>
													</div>
												</div>
												<button class="px-3 py-1.5 bg-purple-100 text-purple-700 rounded-lg text-xs font-medium hover:bg-purple-200 transition-colors">
													Load
												</button>
											</div>
										</div>
									{/each}
								</div>

								<!-- Create new save -->
								<div class="mt-4 p-4 border-2 border-dashed border-slate-200 rounded-xl text-center hover:border-purple-300 hover:bg-purple-50/50 transition-colors cursor-pointer">
									<div class="flex items-center justify-center gap-2 text-slate-500">
										<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
										</svg>
										<span class="text-sm font-medium">Create New Checkpoint</span>
									</div>
								</div>

								<!-- Sync status -->
								<div class="mt-4 p-3 bg-purple-50 rounded-xl border border-purple-200 flex items-center justify-between">
									<div class="flex items-center gap-2 text-purple-700 text-xs">
										<div class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
										All saves synced to cloud
									</div>
									<span class="text-xs text-purple-500">3 devices connected</span>
								</div>
							</div>
						</div>
					{:else}
						<!-- Seamless Writing Feature Demo -->
						<div class="relative w-full h-full flex items-center justify-center">
							<!-- Background glow -->
							<div class="absolute inset-0 bg-linear-to-br from-amber-500/10 via-orange-500/5 to-transparent rounded-3xl"></div>
							
							<!-- Writing visualization -->
							<div class="relative w-full max-w-md">
								<!-- Header -->
								<div class="text-center mb-6">
									<div class="inline-flex items-center gap-2 px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
										<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
										</svg>
										Story Export
									</div>
								</div>

								<!-- Book preview -->
								<div class="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-fade-in-up">
									<!-- Book cover simulation -->
									<div class="bg-linear-to-br from-amber-600 via-orange-500 to-red-500 p-6 text-white">
										<div class="text-xs uppercase tracking-widest opacity-70 mb-2">Your Story</div>
										<h3 class="text-xl font-bold mb-1">Neon Shadows</h3>
										<p class="text-sm opacity-80">A Cyberpunk Adventure</p>
										<div class="mt-4 flex items-center gap-2 text-xs opacity-70">
											<span>By You</span>
											<span>•</span>
											<span>23 Chapters</span>
											<span>•</span>
											<span>45,000 words</span>
										</div>
									</div>

									<!-- Content preview -->
									<div class="p-4">
										<div class="text-xs text-slate-500 uppercase tracking-wide mb-2">Chapter 12 Preview</div>
										<div class="text-sm text-slate-700 leading-relaxed italic">
											"The rain hammered against the neon-lit windows as Maya traced the holographic map. Three days—that's all they had before the corporation's cleanup crews arrived..."
										</div>
									</div>

									<!-- Export options -->
									<div class="p-4 bg-slate-50 border-t border-slate-100">
										<div class="text-xs font-medium text-slate-500 mb-3">Export Format</div>
										<div class="flex gap-2">
											{#each ['EPUB', 'PDF', 'Markdown', 'HTML'] as format}
												<button class="px-3 py-1.5 {format === 'EPUB' ? 'bg-amber-500 text-white' : 'bg-white text-slate-600 border border-slate-200'} rounded-lg text-xs font-medium hover:shadow transition-all">
													{format}
												</button>
											{/each}
										</div>
									</div>
								</div>

								<!-- Publish hint -->
								<div class="mt-4 p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-center gap-2">
									<svg class="w-4 h-4 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
									</svg>
									<p class="text-xs text-amber-700">
										<span class="font-medium">Pro tip:</span> Publish to our community library and let others read your adventure!
									</p>
								</div>
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>
