<script lang="ts">
	import { onMount } from 'svelte';

	type UserRole = 'reader' | 'player' | 'developer';

	interface RoleConfig {
		id: UserRole;
		label: string;
		icon: string;
		headline: string;
		subheadline: string;
		description: string;
		cta: { text: string; href: string };
		secondaryCta: { text: string; href: string };
	}

	const roles: RoleConfig[] = [
		{
			id: 'reader',
			label: 'Reader',
			icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
			headline: 'Discover AI Stories',
			subheadline: 'Written by Players, For You',
			description: 'Explore a growing library of interactive fiction created by our community. Every story is born from real AI roleplay sessions—authentic, unpredictable, and endlessly entertaining.',
			cta: { text: 'Browse Stories', href: 'https://hub.pub.wiki/articles' },
			secondaryCta: { text: 'Popular This Week', href: 'https://hub.pub.wiki/trending' }
		},
		{
			id: 'player',
			label: 'Player',
			icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z',
			headline: 'Play Smarter',
			subheadline: 'Import. Enhance. Immerse.',
			description: 'Bring your favorite character cards and lorebooks from SillyTavern or other platforms. Experience AI roleplay with built-in world state tracking and long-term memory.',
			cta: { text: 'Start Playing', href: 'https://hub.pub.wiki' },
			secondaryCta: { text: 'Import Guide', href: '/docs/import' }
		},
		{
			id: 'developer',
			label: 'Developer',
			icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
			headline: 'Build Your Vision',
			subheadline: 'Visual Flow. Full Control.',
			description: 'Design complex AI experiences with our node-based editor. Connect prompts, add game logic with Lua/TypeScript, and publish your creations for the world to enjoy.',
			cta: { text: 'Open Studio', href: 'https://studio.pub.wiki' },
			secondaryCta: { text: 'View Docs', href: '/docs' }
		}
	];

	let activeRole = $state<UserRole>('player');
	let isTransitioning = $state(false);

	function selectRole(role: UserRole) {
		if (role === activeRole || isTransitioning) return;
		isTransitioning = true;
		setTimeout(() => {
			activeRole = role;
			setTimeout(() => {
				isTransitioning = false;
			}, 50);
		}, 200);
	}

	const currentRole = $derived(roles.find((r) => r.id === activeRole)!);

	// Auto-rotate every 6 seconds (pause on hover)
	let isPaused = $state(false);
	let intervalId: ReturnType<typeof setInterval> | null = null;

	onMount(() => {
		intervalId = setInterval(() => {
			if (!isPaused) {
				const currentIndex = roles.findIndex((r) => r.id === activeRole);
				const nextIndex = (currentIndex + 1) % roles.length;
				selectRole(roles[nextIndex].id);
			}
		}, 6000);

		return () => {
			if (intervalId) clearInterval(intervalId);
		};
	});
</script>

<section
	aria-label="Hero section"
	class="relative min-h-screen overflow-hidden pt-24"
	onmouseenter={() => (isPaused = true)}
	onmouseleave={() => (isPaused = false)}
>
	<!-- Background Gradient -->
	<div class="absolute inset-0 bg-linear-to-br from-slate-50 via-white to-slate-100 -z-10"></div>

	<!-- Decorative Elements -->
	<div class="absolute top-20 left-10 w-72 h-72 bg-slate-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-float"></div>
	<div class="absolute top-40 right-20 w-72 h-72 bg-slate-300 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-float" style="animation-delay: 1s;"></div>
	<div class="absolute bottom-20 left-1/3 w-72 h-72 bg-slate-200 rounded-full mix-blend-multiply filter blur-3xl opacity-25 animate-float" style="animation-delay: 2s;"></div>

	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12 w-full">
		<!-- Role Selector - fixed position relative to page -->
		<p class="text-lg text-slate-500 mb-8 flex flex-wrap items-center gap-x-2 justify-center lg:justify-start">
			<span>I'm a</span>
			{#each roles as role, i (role.id)}
				<button
					onclick={() => selectRole(role.id)}
					class="relative font-semibold transition-all duration-200 {activeRole === role.id
						? 'text-slate-900 underline underline-offset-4 decoration-2 decoration-slate-400'
						: 'text-slate-400 hover:text-slate-600'}"
				>
					{role.label}{#if i < roles.length - 1}<span class="text-slate-300 font-normal ml-2">/</span>{/if}
				</button>
			{/each}
		</p>

		<div class="grid lg:grid-cols-2 gap-12 items-start">
			<!-- Left: Text Content -->
			<div class="text-center lg:text-left min-h-[400px]">
				<div
					class="transition-all duration-300 {isTransitioning ? 'opacity-0 translate-y-4' : 'opacity-100 translate-y-0'}"
				>
					<h1 class="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6">
						<span class="block text-slate-900">{currentRole.headline}</span>
						<span class="block gradient-text">{currentRole.subheadline}</span>
					</h1>

					<p class="text-lg sm:text-xl text-slate-600 mb-8 max-w-xl mx-auto lg:mx-0 leading-relaxed">
						{currentRole.description}
					</p>

					<div class="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
						<a
							href={currentRole.cta.href}
							class="btn-primary inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-white rounded-xl"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
							</svg>
							{currentRole.cta.text}
						</a>
						<a
							href={currentRole.secondaryCta.href}
							class="btn-secondary inline-flex items-center justify-center gap-2 px-6 py-3 text-base font-semibold text-slate-700 rounded-xl"
						>
							{currentRole.secondaryCta.text}
						</a>
					</div>
				</div>

				<!-- Stats -->
				<div class="mt-12 flex items-center justify-center lg:justify-start gap-8">
					<div class="text-center">
						<div class="text-2xl font-bold text-slate-900">1000+</div>
						<div class="text-sm text-slate-500">Creators</div>
					</div>
					<div class="w-px h-10 bg-slate-200"></div>
					<div class="text-center">
						<div class="text-2xl font-bold text-slate-900">5000+</div>
						<div class="text-sm text-slate-500">Artifacts</div>
					</div>
					<div class="w-px h-10 bg-slate-200"></div>
					<div class="text-center">
						<div class="text-2xl font-bold text-slate-900">Open</div>
						<div class="text-sm text-slate-500">Source</div>
					</div>
				</div>
			</div>

			<!-- Right: Visual Demo - Changes based on role -->
			<div class="relative h-[420px]">
				<div
					class="absolute inset-0 transition-all duration-300 {isTransitioning ? 'opacity-0 scale-95' : 'opacity-100 scale-100'}"
				>
					{#if activeRole === 'reader'}
						<!-- Reader: Article/Story Preview -->
						<div class="relative w-full max-w-lg mx-auto">
							<div class="absolute inset-0 bg-linear-to-br from-amber-500/10 via-orange-500/10 to-red-500/10 rounded-3xl blur-2xl"></div>
							<div class="relative bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
								<!-- Article Header -->
								<div class="px-6 py-4 border-b border-slate-100 bg-slate-50">
									<div class="flex items-center gap-3">
										<div class="w-10 h-10 rounded-full bg-linear-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white font-bold text-sm">ND</div>
										<div>
											<div class="font-semibold text-slate-900">NeonDreamer</div>
											<div class="text-xs text-slate-500">Published 2 hours ago</div>
										</div>
									</div>
								</div>
								<!-- Article Content -->
								<div class="p-6">
									<h3 class="text-xl font-bold text-slate-900 mb-3">Chapter 12: The Last Signal</h3>
									<div class="space-y-3 text-slate-600 text-sm leading-relaxed">
										<p>The rain hammered against the neon-lit windows as Maya traced the holographic map with trembling fingers. Three days. That's all they had before the corporation's cleanup crews arrived.</p>
										<p class="text-slate-400 italic">"You know what they'll do if they find us," Kai's voice crackled through the static...</p>
									</div>
									<div class="mt-4 flex items-center gap-4 text-sm text-slate-400">
										<span class="flex items-center gap-1">
											<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
											2.4k
										</span>
										<span class="flex items-center gap-1">
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/></svg>
											128
										</span>
										<span class="flex items-center gap-1">
											<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
											Save
										</span>
									</div>
								</div>
								<!-- More chapters indicator -->
								<div class="px-6 py-3 bg-slate-50 border-t border-slate-100 text-center">
									<span class="text-sm text-slate-500">23 chapters · 45 min read</span>
								</div>
							</div>
						</div>
					{:else if activeRole === 'player'}
						<!-- Player: Character Card + Chat Preview -->
						<div class="relative w-full max-w-lg mx-auto">
							<div class="absolute inset-0 bg-linear-to-br from-purple-500/10 via-pink-500/10 to-blue-500/10 rounded-3xl blur-2xl"></div>
							<div class="relative flex gap-4">
								<!-- Character Card -->
								<div class="w-1/3 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
									<div class="aspect-3/4 bg-linear-to-br from-purple-600 to-pink-500 relative">
										<div class="absolute inset-0 flex items-end p-3">
											<div class="text-white">
												<div class="font-bold text-sm">Aria</div>
												<div class="text-xs opacity-80">Cyber Hunter</div>
											</div>
										</div>
										<!-- Character silhouette -->
										<svg class="absolute inset-0 w-full h-full opacity-20" viewBox="0 0 100 133" fill="white">
											<ellipse cx="50" cy="30" rx="20" ry="25"/>
											<path d="M20 60 Q50 50 80 60 L85 133 H15 Z"/>
										</svg>
									</div>
									<div class="p-2 text-center">
										<div class="flex justify-center gap-1">
											{#each ['💜', '⚔️', '🌙'] as emoji (emoji)}
												<span class="text-xs">{emoji}</span>
											{/each}
										</div>
									</div>
								</div>
								<!-- Chat Interface -->
								<div class="flex-1 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden">
									<div class="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
										<div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
										<span class="text-sm font-medium text-slate-700">Active Session</span>
									</div>
									<div class="p-4 space-y-3 text-sm">
										<div class="flex gap-2">
											<div class="w-6 h-6 rounded-full bg-purple-500 shrink-0"></div>
											<div class="bg-slate-100 rounded-lg rounded-tl-none px-3 py-2 text-slate-700">
												The datapad flickers. "Signal traced to Sector 7."
											</div>
										</div>
										<div class="flex gap-2 justify-end">
											<div class="bg-slate-900 text-white rounded-lg rounded-tr-none px-3 py-2">
												I check my weapon and head out.
											</div>
										</div>
										<div class="flex items-center gap-2 text-slate-400 text-xs">
											<div class="flex gap-1">
												<span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"></span>
												<span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style="animation-delay: 0.1s"></span>
												<span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style="animation-delay: 0.2s"></span>
											</div>
											Aria is typing...
										</div>
									</div>
									<!-- World State Indicator -->
									<div class="px-4 py-2 bg-purple-50 border-t border-purple-100 flex items-center gap-2 text-xs text-purple-700">
										<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
										World State: Day 3 · Trust: 78%
									</div>
								</div>
							</div>
						</div>
					{:else}
						<!-- Developer: Node Graph (existing) -->
						<div class="relative w-full max-w-lg mx-auto">
							<div class="absolute inset-0 bg-linear-to-br from-blue-500/10 via-purple-500/10 to-green-500/10 rounded-3xl blur-2xl"></div>
							<!-- Node Graph SVG -->
							<svg viewBox="0 0 500 380" class="w-full h-full relative z-10">
								<defs>
									<linearGradient id="connGrad" x1="0%" y1="0%" x2="100%" y2="0%">
										<stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.5" />
										<stop offset="100%" stop-color="#22c55e" stop-opacity="0.5" />
									</linearGradient>
									<filter id="nodeShadow" x="-20%" y="-20%" width="140%" height="140%">
										<feDropShadow dx="0" dy="4" stdDeviation="8" flood-opacity="0.1" />
									</filter>
								</defs>

								<!-- Connections -->
								<path d="M160 80 C 200 80, 200 120, 240 120" fill="none" stroke="url(#connGrad)" stroke-width="2" class="animate-draw-line" />
								<path d="M160 180 C 200 180, 200 140, 240 140" fill="none" stroke="url(#connGrad)" stroke-width="2" class="animate-draw-line" style="animation-delay: 0.1s" />
								<path d="M340 130 C 380 130, 380 130, 400 130" fill="none" stroke="url(#connGrad)" stroke-width="2" class="animate-draw-line" style="animation-delay: 0.2s" />
								<path d="M160 280 C 200 280, 200 300, 240 300" fill="none" stroke="url(#connGrad)" stroke-width="2" class="animate-draw-line" style="animation-delay: 0.15s" />
								<path d="M340 300 C 380 300, 380 260, 400 260" fill="none" stroke="url(#connGrad)" stroke-width="2" class="animate-draw-line" style="animation-delay: 0.25s" />
								<path d="M450 170 C 450 210, 450 220, 450 240" fill="none" stroke="url(#connGrad)" stroke-width="2" class="animate-draw-line" style="animation-delay: 0.3s" />

								<!-- Nodes -->
								{#each [
									{ x: 60, y: 60, label: 'System', type: 'PROMPT', color: '#3b82f6' },
									{ x: 60, y: 160, label: 'Character', type: 'PROMPT', color: '#3b82f6' },
									{ x: 240, y: 100, label: 'User Input', type: 'INPUT', color: '#8b5cf6' },
									{ x: 400, y: 110, label: 'Response', type: 'GENERATED', color: '#22c55e' },
									{ x: 60, y: 260, label: 'Lorebook', type: 'VFS', color: '#f59e0b' },
									{ x: 240, y: 280, label: 'Memory', type: 'LOADER', color: '#06b6d4' },
									{ x: 400, y: 220, label: 'Sandbox', type: 'SANDBOX', color: '#ec4899' }
									] as node, i (node.label)}
									<g class="animate-fade-in-up" style="animation-delay: {i * 0.08}s">
										<rect x={node.x} y={node.y} width="100" height="40" rx="8" fill="white" filter="url(#nodeShadow)" stroke={node.color} stroke-opacity="0.3" stroke-width="1" />
										<rect x={node.x} y={node.y} width="100" height="12" rx="8" fill={node.color} />
										<rect x={node.x} y={node.y + 8} width="100" height="4" fill={node.color} />
										<text x={node.x + 10} y={node.y + 28} font-size="11" fill="#24292f" font-weight="500">{node.label}</text>
										<circle cx={node.x} cy={node.y + 20} r="4" fill="white" stroke={node.color} stroke-width="2" />
										<circle cx={node.x + 100} cy={node.y + 20} r="4" fill="white" stroke={node.color} stroke-width="2" />
									</g>
								{/each}
							</svg>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<!-- Scroll Indicator -->
	<div class="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce">
		<svg class="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
		</svg>
	</div>
</section>

<style>
	@keyframes draw-line {
		from { stroke-dasharray: 200; stroke-dashoffset: 200; }
		to { stroke-dasharray: 200; stroke-dashoffset: 0; }
	}
	.animate-draw-line {
		animation: draw-line 0.8s ease-out forwards;
	}
</style>
