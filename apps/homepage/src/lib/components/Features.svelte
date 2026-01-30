<script lang="ts">
	import { onMount } from 'svelte';

	interface Feature {
		icon: string;
		title: string;
		description: string;
		color: string;
		gradient: string;
	}

	const features: Feature[] = [
		{
			icon: 'M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2',
			title: 'Visual Node Editor',
			description:
				'Design complex AI interactions with our intuitive drag-and-drop interface. Connect prompts, inputs, and outputs visually.',
			color: '#3b82f6',
			gradient: 'from-blue-500 to-cyan-500'
		},
		{
			icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
			title: 'Cloud Save Sync',
			description:
				'Your story progress syncs across all devices. Resume your adventure anywhere, anytime with blockchain-verified saves.',
			color: '#8b5cf6',
			gradient: 'from-purple-500 to-pink-500'
		},
		{
			icon: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z',
			title: 'Fork & Remix',
			description:
				'Build on existing creations. Fork any artifact, add your twist, and share. Full lineage tracking shows creative heritage.',
			color: '#22c55e',
			gradient: 'from-green-500 to-emerald-500'
		},
		{
			icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
			title: 'Multi-LLM Support',
			description:
				'Choose your AI engine. Works with OpenAI, Anthropic, Google AI, OpenRouter, or bring your own endpoint.',
			color: '#f59e0b',
			gradient: 'from-amber-500 to-orange-500'
		},
		{
			icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
			title: 'Version History',
			description:
				'Every change is tracked. Browse past versions, compare differences, and restore any point in your creative timeline.',
			color: '#06b6d4',
			gradient: 'from-cyan-500 to-teal-500'
		},
		{
			icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
			title: 'Lua & TypeScript',
			description:
				'Extend with code when you need to. Run custom game logic with Lua or TypeScript in a secure sandboxed environment.',
			color: '#ec4899',
			gradient: 'from-pink-500 to-rose-500'
		}
	];

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

<section id="features" class="py-24 bg-white" bind:this={container}>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<!-- Section Header -->
		<div class="text-center mb-16 reveal">
			<div
				class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-100 text-blue-700 text-sm font-medium mb-4"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
					/>
				</svg>
				Powerful Features
			</div>
			<h2 class="text-3xl sm:text-4xl font-bold text-[#24292f] mb-4">
				Everything You Need to Create
			</h2>
			<p class="text-lg text-[#57606a] max-w-2xl mx-auto">
				From simple chatbots to complex interactive narratives, our platform provides all the tools
				to bring your AI stories to life.
			</p>
		</div>

		<!-- Features Grid -->
		<div class="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
			{#each features as feature, i}
				<div
					class="reveal reveal-delay-{(i % 4) + 1} group relative p-6 rounded-2xl bg-white border border-gray-100 hover:border-transparent hover:shadow-xl transition-all duration-300"
				>
					<!-- Gradient border on hover -->
					<div
						class="absolute inset-0 rounded-2xl bg-gradient-to-r {feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity -z-10 blur-xl"
					></div>
					<div
						class="absolute inset-[1px] rounded-2xl bg-white -z-5"
					></div>

					<!-- Icon -->
					<div
						class="w-12 h-12 rounded-xl bg-gradient-to-r {feature.gradient} flex items-center justify-center mb-4 shadow-lg"
						style="box-shadow: 0 4px 20px {feature.color}40"
					>
						<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={feature.icon} />
						</svg>
					</div>

					<!-- Content -->
					<h3 class="text-lg font-semibold text-[#24292f] mb-2 group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r {feature.gradient} transition-all">
						{feature.title}
					</h3>
					<p class="text-[#57606a] text-sm leading-relaxed">
						{feature.description}
					</p>

					<!-- Learn more link -->
					<button
						class="inline-flex items-center gap-1 mt-4 text-sm font-medium opacity-0 group-hover:opacity-100 transition-opacity"
						style="color: {feature.color}"
					>
						Learn more
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
						</svg>
					</button>
				</div>
			{/each}
		</div>
	</div>
</section>
