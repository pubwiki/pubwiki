<script lang="ts">
	import { onMount } from 'svelte';

	let container: HTMLElement;
	let activeView = $state<'reader' | 'player'>('reader');

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

<section id="publish" class="py-24 bg-gradient-to-b from-slate-50 to-white" bind:this={container}>
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<!-- Section Header -->
		<div class="text-center mb-16 reveal">
			<h2 class="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
				Your Adventures Deserve an Audience
			</h2>
			<p class="text-lg text-slate-600 max-w-3xl mx-auto">
				AI roleplay isn't just for you—it's a story worth sharing. 
				Export your sessions as rich, interactive novels that others can read, explore, and even play.
			</p>
		</div>

		<!-- Main Content -->
		<div class="grid lg:grid-cols-2 gap-12 items-stretch reveal">
			<!-- Left: Article Preview -->
			<div class="relative">
				<!-- Book/Article visualization -->
				<div class="bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden h-full">
					<!-- Article header -->
					<div class="bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 p-6 text-white">
						<div class="flex items-start justify-between">
							<div>
								<div class="text-xs uppercase tracking-widest opacity-70 mb-2">Interactive Story</div>
								<h3 class="text-2xl font-bold mb-1">Neon Shadows</h3>
								<p class="text-sm opacity-80">A Cyberpunk Adventure by @maya_writes</p>
							</div>
							<div class="flex gap-2">
								<div class="px-2 py-1 bg-white/20 rounded text-xs">23 Chapters</div>
								<div class="px-2 py-1 bg-white/20 rounded text-xs">45k words</div>
							</div>
						</div>
					</div>

					<!-- Article content preview -->
					<div class="p-6">
						<!-- Chapter navigation -->
						<div class="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
							<div class="flex items-center gap-2">
								<button class="p-1.5 rounded hover:bg-slate-100 text-slate-400">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
									</svg>
								</button>
								<span class="text-sm font-medium text-slate-700">Chapter 12: The Betrayal</span>
								<button class="p-1.5 rounded hover:bg-slate-100 text-slate-400">
									<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
									</svg>
								</button>
							</div>
							<div class="text-xs text-slate-400">3,245 reads</div>
						</div>

						<!-- Story text -->
						<div class="prose prose-slate prose-sm max-w-none mb-6">
							<p class="text-slate-700 leading-relaxed">
								The rain hammered against the neon-lit windows as Maya traced the holographic map. 
								Three days—that's all they had before the corporation's cleanup crews arrived.
							</p>
							<p class="text-slate-700 leading-relaxed">
								<span class="text-amber-600 font-medium cursor-pointer hover:underline" title="View character details">Aria</span> 
								stepped out of the shadows, her chrome arm glinting in the artificial light. 
								"I found something," she whispered, pulling out a 
								<span class="text-cyan-600 font-medium cursor-pointer hover:underline" title="View item details">hacked datapad</span>.
							</p>
						</div>

						<!-- Inline Wiki Panel -->
						<div class="bg-slate-50 rounded-xl p-4 border border-slate-200 mb-6">
							<div class="flex items-start gap-3">
								<div class="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-500 to-rose-600 flex items-center justify-center shrink-0">
									<svg class="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
										<ellipse cx="12" cy="8" rx="5" ry="6"/>
										<path d="M4 18 Q12 14 20 18 L21 24 H3 Z"/>
									</svg>
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 mb-1">
										<h4 class="font-semibold text-slate-900 text-sm">Aria Nightblade</h4>
										<span class="px-1.5 py-0.5 bg-pink-100 text-pink-600 rounded text-xs">Ally</span>
									</div>
									<p class="text-xs text-slate-600 mb-2">Former corporate assassin. Trust Level: 78%</p>
									<div class="flex items-center gap-3 text-xs text-slate-500">
										<span class="flex items-center gap-1">
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
											Combat: Expert
										</span>
										<span class="flex items-center gap-1">
											<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>
											Hacking: Advanced
										</span>
									</div>
								</div>
							</div>
						</div>

						<!-- Play from here button -->
						<button class="w-full py-3 rounded-xl bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 group">
							<svg class="w-5 h-5 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
							Play from This Moment
						</button>
					</div>
				</div>
			</div>

			<!-- Right: Features explanation -->
			<div class="h-full flex flex-col">
				<!-- Header -->
				<div class="mb-8">
					<h3 class="text-2xl font-bold text-slate-900 mb-3">More Than Just Text</h3>
					<p class="text-slate-600 leading-relaxed">
						When you export your roleplay, we bundle the entire world—character wikis, 
						relationship graphs, inventory states, and save points at every chapter.
					</p>
				</div>

				<!-- Features as flowing list -->
				<div class="flex-1 flex flex-col justify-between">
					<!-- Feature 1: Play From Any Point -->
					<div class="group flex items-start gap-5 py-6 border-b border-slate-200">
						<div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-green-100 group-hover:bg-green-200 transition-colors">
							<svg class="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664zM21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
							</svg>
						</div>
						<div>
							<h4 class="font-semibold text-slate-900 text-lg mb-1 group-hover:text-green-600 transition-colors">Play From Any Point</h4>
							<p class="text-slate-600 text-sm leading-relaxed">Every chapter includes a save point. Readers can jump in and continue the story their own way.</p>
						</div>
					</div>

					<!-- Feature 2: Fork & Remix -->
					<div class="group flex items-start gap-5 py-6 border-b border-slate-200">
						<div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-purple-100 group-hover:bg-purple-200 transition-colors">
							<svg class="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
							</svg>
						</div>
						<div>
							<h4 class="font-semibold text-slate-900 text-lg mb-1 group-hover:text-purple-600 transition-colors">Fork & Remix</h4>
							<p class="text-slate-600 text-sm leading-relaxed">Others can branch off from your story, creating alternate timelines and "what if" scenarios.</p>
						</div>
					</div>

					<!-- Feature 3: Built-in Wiki -->
					<div class="group flex items-start gap-5 py-6">
						<div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-blue-100 group-hover:bg-blue-200 transition-colors">
							<svg class="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
							</svg>
						</div>
						<div>
							<h4 class="font-semibold text-slate-900 text-lg mb-1 group-hover:text-blue-600 transition-colors">Built-in Wiki</h4>
							<p class="text-slate-600 text-sm leading-relaxed">Tap any character, location, or item to see full details—like having a personal wiki for your story.</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
