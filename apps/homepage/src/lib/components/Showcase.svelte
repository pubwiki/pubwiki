<script lang="ts">
	import { onMount } from 'svelte';

	interface ShowcaseItem {
		id: string;
		title: string;
		author: string;
		description: string;
		tags: string[];
		stars: number;
		forks: number;
		gradient: string;
		category: string;
	}

	const showcaseItems: ShowcaseItem[] = [
		{
			id: '1',
			title: 'Cyber Noir Detective',
			author: 'NeonDreamer',
			description: 'Investigate mysteries in a rain-soaked cyberpunk city. Your choices shape the story.',
			tags: ['Cyberpunk', 'Mystery', 'Noir'],
			stars: 1284,
			forks: 156,
			gradient: 'from-purple-600 to-blue-600',
			category: 'Game'
		},
		{
			id: '2',
			title: 'Fantasy Kingdom Builder',
			author: 'WorldSmith',
			description: 'Build and manage your own medieval kingdom with AI advisors and dynamic events.',
			tags: ['Fantasy', 'Strategy', 'Simulation'],
			stars: 892,
			forks: 234,
			gradient: 'from-amber-500 to-orange-600',
			category: 'Game'
		},
		{
			id: '3',
			title: 'Wuxia Master',
			author: 'DragonSage',
			description: 'Train in ancient martial arts, cultivate your inner strength, and become a legend.',
			tags: ['Xianxia', 'Action', 'RPG'],
			stars: 2341,
			forks: 412,
			gradient: 'from-red-500 to-pink-600',
			category: 'Game'
		},
		{
			id: '4',
			title: 'Space Station 13+',
			author: 'CosmicEngineer',
			description: 'Survive aboard a chaotic space station. Traitors, aliens, and endless possibilities.',
			tags: ['Sci-Fi', 'Survival', 'Multiplayer'],
			stars: 1567,
			forks: 289,
			gradient: 'from-cyan-500 to-blue-600',
			category: 'Game'
		},
		{
			id: '5',
			title: 'Character Studio Pro',
			author: 'CharacterAI',
			description: 'Create consistent, deep character personalities with advanced prompt engineering.',
			tags: ['Tool', 'Characters', 'Template'],
			stars: 3421,
			forks: 876,
			gradient: 'from-green-500 to-emerald-600',
			category: 'Recipe'
		},
		{
			id: '6',
			title: 'Horror Anthology',
			author: 'NightmareWeaver',
			description: 'A collection of psychological horror scenarios. Not for the faint of heart.',
			tags: ['Horror', 'Anthology', 'Mature'],
			stars: 756,
			forks: 98,
			gradient: 'from-gray-700 to-gray-900',
			category: 'Game'
		}
	];

	let container: HTMLElement;
	let filter = $state('All');
	const filters = ['All', 'Game', 'Recipe'];

	const filteredItems = $derived(
		filter === 'All' ? showcaseItems : showcaseItems.filter((item) => item.category === filter)
	);

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

<section id="showcase" class="py-24 bg-white" bind:this={container}>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<!-- Section Header -->
		<div class="text-center mb-12 reveal">
			<div
				class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium mb-4"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
					/>
				</svg>
				Featured Creations
			</div>
			<h2 class="text-3xl sm:text-4xl font-bold text-[#24292f] mb-4">Discover Amazing Works</h2>
			<p class="text-lg text-[#57606a] max-w-2xl mx-auto">
				Explore what our community has created. Play, learn, and get inspired.
			</p>
		</div>

		<!-- Filter Tabs -->
		<div class="flex justify-center gap-2 mb-12 reveal">
			{#each filters as f}
				<button
					class="px-4 py-2 text-sm font-medium rounded-lg transition-all {filter === f
						? 'bg-[#24292f] text-white'
						: 'bg-gray-100 text-gray-600 hover:bg-gray-200'}"
					onclick={() => (filter = f)}
				>
					{f}
				</button>
			{/each}
		</div>

		<!-- Showcase Grid -->
		<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
			{#each filteredItems as item, i (item.id)}
				<a
					href="https://hub.pub.wiki/artifact/{item.id}"
					class="reveal reveal-delay-{(i % 4) + 1} group block rounded-2xl overflow-hidden bg-white border border-gray-100 hover:shadow-2xl transition-all duration-300 hover:-translate-y-1"
				>
					<!-- Cover Image/Gradient -->
					<div class="relative h-40 bg-gradient-to-br {item.gradient} overflow-hidden">
						<!-- Decorative pattern -->
						<div class="absolute inset-0 opacity-20">
							<svg class="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
								<defs>
									<pattern id="grid-{item.id}" width="10" height="10" patternUnits="userSpaceOnUse">
										<path d="M 10 0 L 0 0 0 10" fill="none" stroke="white" stroke-width="0.5" />
									</pattern>
								</defs>
								<rect width="100" height="100" fill="url(#grid-{item.id})" />
							</svg>
						</div>

						<!-- Category Badge -->
						<div class="absolute top-3 left-3">
							<span class="px-2 py-1 text-xs font-medium bg-white/20 backdrop-blur-sm text-white rounded-full">
								{item.category}
							</span>
						</div>

						<!-- Play overlay -->
						<div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
							<div class="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg">
								<svg class="w-6 h-6 text-gray-800 ml-1" fill="currentColor" viewBox="0 0 24 24">
									<path d="M8 5v14l11-7z" />
								</svg>
							</div>
						</div>
					</div>

					<!-- Content -->
					<div class="p-5">
						<div class="flex items-start justify-between mb-2">
							<h3 class="font-semibold text-[#24292f] group-hover:text-[#0969da] transition-colors">
								{item.title}
							</h3>
						</div>
						<p class="text-xs text-[#57606a] mb-3">by @{item.author}</p>
						<p class="text-sm text-[#57606a] mb-4 line-clamp-2">{item.description}</p>

						<!-- Tags -->
						<div class="flex flex-wrap gap-1 mb-4">
							{#each item.tags.slice(0, 3) as tag}
								<span class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
									{tag}
								</span>
							{/each}
						</div>

						<!-- Stats -->
						<div class="flex items-center justify-between text-sm text-[#57606a] pt-4 border-t border-gray-100">
							<span class="flex items-center gap-1">
								<svg class="w-4 h-4 text-yellow-500" fill="currentColor" viewBox="0 0 24 24">
									<path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
								</svg>
								{item.stars.toLocaleString()}
							</span>
							<span class="flex items-center gap-1">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
								</svg>
								{item.forks} forks
							</span>
							<span class="text-green-600 font-medium">Free</span>
						</div>
					</div>
				</a>
			{/each}
		</div>

		<!-- View More -->
		<div class="text-center mt-12 reveal">
			<a
				href="https://hub.pub.wiki"
				class="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-[#0969da] border-2 border-[#0969da] rounded-xl hover:bg-[#0969da] hover:text-white transition-all"
			>
				Explore All Artifacts
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
				</svg>
			</a>
		</div>
	</div>
</section>
