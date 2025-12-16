<script lang="ts">
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { useArtifactStore, type ArtifactDetails } from '$lib/stores/artifacts.svelte';
	import type { ArtifactListItem, ArtifactLineageItem } from '$lib/types';
	import ArtifactCard from '$lib/components/ArtifactCard.svelte';
	import LineageGraph from '$lib/components/LineageGraph.svelte';

	let { data } = $props<{ data: PageData }>();
	
	const artifactStore = useArtifactStore();
	
	let details = $state<ArtifactDetails | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);

	// Fetch artifact details when component mounts or id changes
	$effect(() => {
		const artifactId = data.artifactId;
		loading = true;
		error = null;
		
		artifactStore.fetchArtifactDetails(artifactId).then((result) => {
			if (result) {
				details = result;
			} else {
				error = 'Artifact not found';
			}
			loading = false;
		}).catch((e) => {
			error = e instanceof Error ? e.message : 'Failed to load artifact';
			loading = false;
		});
	});

	let artifact = $derived(details?.artifact);
	let files = $derived(details?.files ?? []);
	let parents = $derived(details?.parents ?? []);
	let children = $derived(details?.children ?? []);

	let activeTab = $state('Overview');
	const tabs = ['Overview', 'Lineage', 'Discussion', 'Source Code'];

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
	}

	function formatBytes(bytes: number | null | undefined): string {
		if (!bytes) return '0 B';
		const units = ['B', 'KB', 'MB', 'GB'];
		let i = 0;
		while (bytes >= 1024 && i < units.length - 1) {
			bytes /= 1024;
			i++;
		}
		return `${bytes.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
	}
</script>

{#if loading}
	<div class="min-h-screen bg-[#f6f8fa] flex items-center justify-center">
		<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0969da]"></div>
	</div>
{:else if error || !artifact}
	<div class="min-h-screen bg-[#f6f8fa] flex items-center justify-center">
		<div class="text-center">
			<h1 class="text-2xl font-bold text-gray-900 mb-2">Not Found</h1>
			<p class="text-gray-600 mb-4">{error || 'Artifact not found'}</p>
			<button onclick={() => goto('/')} class="text-[#0969da] hover:underline">
				Go back home
			</button>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-[#f6f8fa] pb-12 font-sans">
		<!-- Top Header / Breadcrumbs -->
		<div class="bg-[#f6f8fa] border-b border-gray-200 py-4">
			<div class="mx-auto max-w-[1200px] px-4 flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm text-gray-600">
					<span class="hover:underline cursor-pointer">{artifact.author.displayName || artifact.author.username}</span>
					<span>/</span>
					<span class="font-bold text-gray-900">{artifact.name}</span>
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
							{(artifact.stats?.starCount ?? 0).toLocaleString()}
						</div>
					</div>

					<!-- Fork Button -->
					<div class="flex items-center bg-white border border-gray-300 rounded-md text-xs overflow-hidden shadow-sm">
						<button class="px-3 py-1 font-semibold flex items-center gap-1 hover:bg-gray-50 transition">
							<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
							Fork
						</button>
						<div class="px-2 py-1 bg-gray-50 border-l border-gray-300 font-bold text-gray-700">
							{(artifact.stats?.forkCount ?? 0).toLocaleString()}
						</div>
					</div>
				</div>
			</div>
		</div>

		<div class="mx-auto max-w-[1200px] px-4 py-6">
			
			<!-- Main Layout: 2 Columns (Left: Content, Right: Sidebar) -->
			<div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
				
				<!-- LEFT COLUMN: Preview & Tabs (2/3 width) -->
				<div class="lg:col-span-2 space-y-6">
					
					<!-- Preview Area -->
					<div class="bg-black rounded-lg overflow-hidden shadow-sm border border-gray-200 aspect-video relative group">
						<img 
							src={artifact.thumbnailUrl || 'https://placehold.co/800x400/222/fff?text=No+Image'} 
							alt={artifact.name} 
							class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition duration-500" 
						/>
						<!-- Play Icon Overlay (Optional) -->
						<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
							<div class="bg-black/50 rounded-full p-4 opacity-0 group-hover:opacity-100 transition duration-300">
								<svg class="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
							</div>
						</div>
					</div>

					<!-- Tabs Navigation -->
					<div class="border-b border-gray-200">
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
					<div class="bg-white rounded-md border border-gray-200 p-6 min-h-[400px]">
						{#if activeTab === 'Overview'}
							<div class="prose max-w-none">
								<p class="text-gray-600 mb-6">{artifact.description || 'No description provided.'}</p>

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
							{#if browser && (parents.length > 0 || children.length > 0)}
								<LineageGraph {artifact} {parents} {children} />
							{:else}
								<div class="text-center py-12 text-gray-500">
									No lineage information available.
								</div>
							{/if}
						{:else if activeTab === 'Source Code'}
							<div>
								<div class="flex items-center justify-between mb-4">
									<h3 class="font-bold text-gray-700">Files</h3>
									<span class="text-xs text-gray-500">{files.length} files</span>
								</div>
								
								{#if files.length > 0}
									<div class="border border-gray-200 rounded-md overflow-hidden">
										<table class="min-w-full divide-y divide-gray-200">
											<thead class="bg-gray-50">
												<tr>
													<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
													<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Size</th>
													<th scope="col" class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
												</tr>
											</thead>
											<tbody class="bg-white divide-y divide-gray-200">
												{#each files as file}
													<tr class="hover:bg-gray-50 cursor-pointer">
														<td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-[#0969da] flex items-center gap-2">
															<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
															{file.filepath}
														</td>
														<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{formatBytes(file.sizeBytes)}</td>
														<td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{file.mimeType || 'unknown'}</td>
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
				</div>

				<!-- RIGHT COLUMN: Sidebar (1/3 width) -->
				<div class="lg:col-span-1 space-y-8">
					
					<!-- 1. BIG ACTION BUTTON (Moved to Top) -->
					<div>
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

					<!-- 2. Project Info Card -->
					<div class="bg-white p-5 rounded-md border border-gray-200 shadow-sm">
						<h1 class="text-2xl font-bold text-gray-900 leading-tight mb-3">{artifact.name}</h1>
						
						<div class="flex items-center gap-2 mb-4 text-sm text-gray-500">
							<img 
								class="w-6 h-6 rounded-full" 
								src={artifact.author.avatarUrl || `https://ui-avatars.com/api/?name=${artifact.author.username}&background=random`} 
								alt={artifact.author.username} 
							/>
							<span class="font-medium text-gray-700">{artifact.author.displayName || artifact.author.username}</span>
							<span>•</span>
							<span>{formatDate(artifact.createdAt)}</span>
						</div>

						<p class="text-sm text-gray-700 mb-4 leading-relaxed">{artifact.description || 'No description'}</p>

						<div class="flex flex-wrap gap-2 mb-4">
							{#each artifact.tags as tag}
								<span class="bg-[#ddf4ff] text-[#0969da] text-xs px-2 py-1 rounded-full font-medium hover:bg-[#b6e3ff] cursor-pointer transition">
									{tag.name}
								</span>
							{/each}
						</div>

						{#if artifact.license}
							<div class="mb-4 text-xs text-gray-500 flex items-center gap-1">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>
								<span>License: {artifact.license}</span>
							</div>
						{/if}

						<div class="grid grid-cols-2 gap-2 text-sm bg-gray-50 p-3 rounded border border-gray-200">
							<div class="flex items-center gap-2 text-gray-600">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
								<span>{(artifact.stats?.viewCount ?? 0).toLocaleString()} views</span>
							</div>
							<div class="flex items-center gap-2 text-gray-600">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
								<span>{(artifact.stats?.downloadCount ?? 0).toLocaleString()} downloads</span>
							</div>
						</div>
					</div>

					<!-- 3. Parents (Dependencies) -->
					{#if parents.length > 0}
						<div>
							<h3 class="font-bold text-gray-900 mb-3 flex items-center gap-2">
								Dependencies
								<span class="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{parents.length}</span>
							</h3>
							<div class="space-y-3">
								{#each parents as item}
									<ArtifactCard lineageItem={item} />
								{/each}
							</div>
						</div>
					{/if}

					<!-- 4. Children (Dependents / Forks) -->
					{#if children.length > 0}
						<div>
							<h3 class="font-bold text-gray-900 mb-3 flex items-center gap-2">
								Used By
								<span class="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">{children.length}</span>
							</h3>
							<div class="space-y-3">
								{#each children as item}
									<ArtifactCard lineageItem={item} />
								{/each}
							</div>
						</div>
					{/if}

				</div>
			</div>
		</div>
	</div>
{/if}
