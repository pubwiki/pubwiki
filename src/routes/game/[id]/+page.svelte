<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';

	let { data } = $props<{ data: PageData }>();
	let { artifact, remixes, forks } = $derived(data);

	let activeTab = $state('Overview');
	const tabs = ['Overview', 'Lineage', 'Discussion', 'Source Code'];
</script>

<div class="min-h-screen bg-[#f6f8fa] pb-12 font-sans">
	<!-- Top Header / Breadcrumbs -->
	<div class="bg-[#f6f8fa] border-b border-gray-200 py-4">
		<div class="mx-auto max-w-[1200px] px-4 flex items-center justify-between">
			<div class="flex items-center gap-2 text-sm text-gray-600">
				<span class="hover:underline cursor-pointer">{artifact.owner_name}</span>
				<span>/</span>
				<span class="font-bold text-gray-900">{artifact.title}</span>
				<span class="px-2 py-0.5 text-xs border border-gray-300 rounded-full text-gray-500 ml-2">
					{artifact.type}
				</span>
				<span class="text-xs text-gray-500 ml-2">{artifact.visibility}</span>
			</div>
			
			<!-- User Profile / Actions placeholder -->
			<div class="flex items-center gap-4">
				<!-- Star Button -->
				<div class="flex items-center bg-white border border-gray-300 rounded-md text-xs overflow-hidden shadow-sm">
					<button class="px-3 py-1 font-semibold flex items-center gap-1 hover:bg-gray-50 transition">
						<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
						Star
					</button>
					<div class="px-2 py-1 bg-gray-50 border-l border-gray-300 font-bold text-gray-700">
						{artifact.stats.stars.toLocaleString()}
					</div>
				</div>

				<!-- Fork Button -->
				<div class="flex items-center bg-white border border-gray-300 rounded-md text-xs overflow-hidden shadow-sm">
					<button class="px-3 py-1 font-semibold flex items-center gap-1 hover:bg-gray-50 transition">
						<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
						Fork
					</button>
					<div class="px-2 py-1 bg-gray-50 border-l border-gray-300 font-bold text-gray-700">
						{artifact.stats.forks.toLocaleString()}
					</div>
				</div>
			</div>
		</div>
	</div>

	<div class="mx-auto max-w-[1200px] px-4 py-6">
		
		<!-- Top Section: Steam-like Layout -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
			<!-- Left: Preview (2 cols wide) -->
			<div class="lg:col-span-2">
				<div class="bg-black rounded-lg overflow-hidden shadow-sm border border-gray-200 aspect-video relative group">
					<img src={artifact.coverImage} alt={artifact.title} class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition duration-500" />
					<!-- Play Icon Overlay (Optional) -->
					<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
						<div class="bg-black/50 rounded-full p-4 opacity-0 group-hover:opacity-100 transition duration-300">
							<svg class="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
						</div>
					</div>
				</div>
			</div>

			<!-- Right: Info Card (1 col wide) -->
			<div class="lg:col-span-1 flex flex-col gap-4">
				<!-- Title & Meta -->
				<div>
					<h1 class="text-3xl font-bold text-gray-900 leading-tight">{artifact.title}</h1>
					<div class="flex items-center gap-2 mt-2 text-sm text-gray-500">
						<img class="w-5 h-5 rounded-full" src="https://ui-avatars.com/api/?name={artifact.owner_name}&background=random" alt={artifact.owner_name} />
						<span>{artifact.owner_name}</span>
						<span>•</span>
						<span>{artifact.created_at.toLocaleDateString()}</span>
					</div>
				</div>

				<!-- Description -->
				<div class="bg-white p-4 rounded-md border border-gray-200 shadow-sm">
					<p class="text-sm text-gray-700 line-clamp-4 leading-relaxed">{artifact.description}</p>
				</div>

				<!-- Tags -->
				<div class="flex flex-wrap gap-2">
					{#each artifact.tags as tag}
						<span class="bg-[#ddf4ff] text-[#0969da] text-xs px-2 py-1 rounded-full font-medium hover:bg-[#b6e3ff] cursor-pointer transition">
							{tag}
						</span>
					{/each}
				</div>

				<!-- Stats Grid -->
				<div class="grid grid-cols-2 gap-2 text-sm bg-gray-50 p-3 rounded border border-gray-200">
					<div class="flex items-center gap-2 text-gray-600">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
						<span>{artifact.stats.views.toLocaleString()} views</span>
					</div>
					<div class="flex items-center gap-2 text-gray-600">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
						<span>{artifact.stats.runs.toLocaleString()} runs</span>
					</div>
				</div>

				<!-- BIG ACTION BUTTON -->
				<div class="mt-auto pt-4">
					{#if artifact.type === 'GAME'}
						<button class="w-full bg-[#2da44e] hover:bg-[#2c974b] text-white py-4 rounded-md font-bold text-xl shadow-md transition flex items-center justify-center gap-2 transform hover:scale-[1.02]">
							<svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
							PLAY NOW
						</button>
					{:else}
						<button class="w-full bg-[#0969da] hover:bg-[#0a53be] text-white py-4 rounded-md font-bold text-xl shadow-md transition flex items-center justify-center gap-2 transform hover:scale-[1.02]">
							<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
							RUN GENERATOR
						</button>
					{/if}
				</div>
			</div>
		</div>

		<!-- Main Content Grid -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
			
			<!-- Left Column: Tabs & Content -->
			<div class="lg:col-span-2">
				<!-- Tabs -->
				<div class="border-b border-gray-200 mb-4">
					<nav class="-mb-px flex space-x-8" aria-label="Tabs">
						{#each tabs as tab}
							<button
								onclick={() => activeTab = tab}
								class="{activeTab === tab
									? 'border-[#fd8c73] text-gray-900'
									: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
									whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors"
							>
								{tab}
							</button>
						{/each}
					</nav>
				</div>

				<!-- Tab Content -->
				<div class="bg-white rounded-md border border-gray-200 p-6 min-h-[300px]">
					{#if activeTab === 'Overview'}
						<div class="prose max-w-none">
							<h3 class="text-lg font-bold mb-2">About this Artifact</h3>
							<p class="text-gray-600 mb-6">{artifact.description}</p>
							
							<div class="bg-gray-50 p-4 rounded-md border border-gray-200 mb-6">
								<h3 class="font-bold text-sm text-gray-700 mb-2">Technical Details</h3>
								<div class="grid grid-cols-2 gap-4 text-sm">
									<div>
										<span class="text-gray-500">Version:</span>
										<span class="font-mono text-gray-800 ml-1">{artifact.version_tag}</span>
										<span class="text-gray-400 text-xs ml-1">({artifact.version_hash.substring(0, 7)})</span>
									</div>
									<div>
										<span class="text-gray-500">License:</span>
										<span class="text-gray-800 ml-1">MIT</span>
									</div>
								</div>
							</div>

							{#if artifact.type === 'RECIPE'}
								<h3 class="text-lg font-bold mb-2">Inputs</h3>
								<ul class="list-disc pl-5 mb-4 text-gray-700">
									<li><strong>Theme</strong> (String): The visual style of the city.</li>
									<li><strong>Density</strong> (String): Low, Medium, or High.</li>
									<li><strong>Wealth</strong> (String): Low, Medium, or High.</li>
								</ul>

								<h3 class="text-lg font-bold mb-2">Outputs</h3>
								<ul class="list-disc pl-5 text-gray-700">
									<li><strong>WorldConfig</strong> (XML): ECS entity definitions.</li>
									<li><strong>MapData</strong> (Lua): Procedural generation logic.</li>
								</ul>
							{/if}
						</div>
					{:else if activeTab === 'Lineage'}
						<div class="flex flex-col items-center justify-center h-64 text-gray-500">
							<svg class="w-12 h-12 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" /></svg>
							<p>Lineage Graph Visualization Placeholder</p>
							<p class="text-xs mt-2">Shows parent recipes and derived artifacts.</p>
						</div>
					{:else if activeTab === 'Source Code'}
						<div>
							<div class="flex items-center justify-between mb-4">
								<h3 class="font-bold text-gray-700">Files</h3>
								<span class="text-xs text-gray-500">{artifact.files?.length || 0} files</span>
							</div>
							
							{#if artifact.files && artifact.files.length > 0}
								<div class="border border-gray-200 rounded-md overflow-hidden">
									<table class="min-w-full divide-y divide-gray-200">
										<thead class="bg-gray-50">
											<tr>
												<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
												<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
												<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Language</th>
											</tr>
										</thead>
										<tbody class="bg-white divide-y divide-gray-200">
											{#each artifact.files as file}
												<tr class="hover:bg-gray-50 cursor-pointer">
													<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-[#0969da] flex items-center gap-2">
														<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
														{file.path}
													</td>
													<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{file.size} B</td>
													<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{file.language}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{:else}
								<div class="text-center py-12 text-gray-500 bg-gray-50 rounded border border-dashed border-gray-300">
									No source files available.
								</div>
							{/if}
						</div>
					{:else}
						<div class="text-center py-12 text-gray-500">
							No discussions yet.
						</div>
					{/if}
				</div>

				<!-- Remixes / History Section (Only for Recipes) -->
				{#if artifact.type === 'RECIPE' && remixes.length > 0}
					<div class="mt-8">
						<h2 class="text-xl font-bold mb-4 flex items-center gap-2">
							Generation History (Remixes)
							<span class="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">{remixes.length}</span>
						</h2>
						
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							{#each remixes as remix}
								<a href="/game/{remix.id}" class="block bg-white border border-gray-200 rounded-lg hover:border-blue-400 transition shadow-sm hover:shadow-md overflow-hidden">
									<div class="flex h-24">
										<div class="w-24 h-24 flex-shrink-0">
											<img src={remix.coverImage} alt={remix.title} class="w-full h-full object-cover" />
										</div>
										<div class="p-3 flex flex-col justify-between flex-1">
											<div>
												<h3 class="font-bold text-sm text-[#0969da] line-clamp-1">{remix.title}</h3>
												<p class="text-xs text-gray-500">by {remix.owner_name}</p>
											</div>
											<div class="flex items-center justify-between text-xs text-gray-400">
												<span>{remix.created_at.toLocaleDateString()}</span>
												<div class="flex items-center gap-2">
													<span class="flex items-center gap-0.5"><svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> {remix.stats.stars}</span>
												</div>
											</div>
										</div>
									</div>
								</a>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Forks Section -->
				{#if forks && forks.length > 0}
					<div class="mt-8">
						<h2 class="text-xl font-bold mb-4 flex items-center gap-2">
							Forks
							<span class="bg-gray-200 text-gray-600 text-xs px-2 py-0.5 rounded-full">{forks.length}</span>
						</h2>
						
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							{#each forks as fork}
								<a href="/game/{fork.id}" class="block bg-white border border-gray-200 rounded-lg hover:border-blue-400 transition shadow-sm hover:shadow-md overflow-hidden">
									<div class="p-4">
										<div class="flex items-center gap-2 mb-2">
											<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
											<h3 class="font-bold text-sm text-[#0969da] line-clamp-1">{fork.title}</h3>
										</div>
										<p class="text-xs text-gray-500 mb-2 line-clamp-2">{fork.description}</p>
										<div class="flex items-center justify-between text-xs text-gray-400">
											<span>by {fork.owner_name}</span>
											<span>{fork.created_at.toLocaleDateString()}</span>
										</div>
									</div>
								</a>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Right Column: Sidebar (Optional / Empty for now as requested to remove sections) -->
			<div class="space-y-6">
				<!-- We removed Languages and Contributors as requested. -->
				<!-- We can put "More from this user" or "Related Artifacts" here later. -->
				<!-- For now, let's leave it empty or put a placeholder to maintain the grid structure if needed, 
					 but since the top section is already split, maybe we don't need this column to be populated heavily.
					 Actually, let's put a "Related" placeholder just so it doesn't look too empty. -->
				
				<div class="bg-white rounded-md border border-gray-200 p-4">
					<h3 class="font-bold text-gray-900 mb-3">Related Artifacts</h3>
					<p class="text-sm text-gray-500">No related artifacts found.</p>
				</div>
			</div>
		</div>
	</div>
</div>
