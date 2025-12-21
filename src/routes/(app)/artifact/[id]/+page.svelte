<script lang="ts">
	import type { PageData } from './$types';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { useArtifactStore, type ArtifactDetails } from '$lib/stores/artifacts.svelte';
	import ArtifactCard from '$lib/components/ArtifactCard.svelte';
	import LineageGraph from '$lib/components/LineageGraph.svelte';
	import NodeCard from '$lib/components/NodeCard.svelte';
	import { getCurrentProject, setCurrentProject } from '../../../studio/stores/db';
	import { importArtifactToNewProject, addArtifactToProject } from '../../../studio/utils/import';

	let { data } = $props<{ data: PageData }>();
	
	const artifactStore = useArtifactStore();
	
	let details = $state<ArtifactDetails | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	
	// Check if there's a current project in studio
	let currentProject = $state<string | null>(null);
	
	$effect(() => {
		if (browser) {
			currentProject = getCurrentProject();
		}
	});

	/**
	 * Create a new studio project and import the artifact
	 */
	async function handleUseArtifact() {
		if (!details?.graph) return;
		
		const newProjectId = await importArtifactToNewProject(
			details.graph,
			artifact!.id,
			artifactStore
		);
		
		setCurrentProject(newProjectId);
		goto(`/studio/${newProjectId}`);
	}

	/**
	 * Add artifact nodes to the current studio project
	 */
	async function handleAddToProject() {
		if (!details?.graph || !currentProject) return;
		
		await addArtifactToProject(
			details.graph,
			artifact!.id,
			currentProject,
			artifactStore
		);
		
		goto(`/studio/${currentProject}`);
	}

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
	let homepage = $derived(details?.homepage);
	let nodes = $derived(details?.graph?.nodes ?? []);
	let parents = $derived(details?.parents ?? []);
	let children = $derived(details?.children ?? []);

	let activeTab = $state('Overview');
	const tabs = ['Overview', 'Nodes', 'Lineage', 'Discussion'];

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
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
							{#if homepage}
								<div class="prose max-w-none artifact-homepage">
									{@html homepage}
								</div>
							{:else}
								<div class="prose max-w-none">
									<p class="text-gray-600">{artifact.description || 'No description provided.'}</p>
								</div>
							{/if}
						{:else if activeTab === 'Nodes'}
							<div>
								<div class="flex items-center justify-between mb-4">
									<h3 class="font-bold text-gray-700">Nodes</h3>
									<span class="text-xs text-gray-500">{nodes.length} nodes</span>
								</div>
								
								{#if nodes.length > 0}
									<div class="flex flex-col gap-4">
										{#each nodes as node}
											<NodeCard {node} artifactId={artifact.id} />
										{/each}
									</div>
								{:else}
									<div class="text-center py-12 text-gray-500 bg-gray-50 rounded border border-dashed border-gray-300">
										No nodes available.
									</div>
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
						{:else}
							<div class="text-center py-12 text-gray-500">
								No discussions yet.
							</div>
						{/if}
					</div>
				</div>

				<!-- RIGHT COLUMN: Sidebar (1/3 width) -->
				<div class="lg:col-span-1 space-y-6">
					
					<!-- 1. Project Info Card -->
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

					<!-- 2. Action Buttons -->
					<div class="space-y-2">
						{#if !currentProject}
							<!-- No current project: show single "Use Artifact" button -->
							<button 
								onclick={handleUseArtifact}
								class="w-full bg-[#0969da] hover:bg-[#0a53be] text-white py-2.5 px-4 rounded-md font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
								Use Artifact
							</button>
						{:else}
							<!-- Has current project: show "Add to Project" as primary, "Use Artifact" as secondary -->
							<button 
								onclick={handleAddToProject}
								class="w-full bg-[#2da44e] hover:bg-[#2c974b] text-white py-2.5 px-4 rounded-md font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
								Add to Current Project
							</button>
							
							<button 
								onclick={handleUseArtifact}
								class="w-full bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 py-2.5 px-4 rounded-md font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
							>
								<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
								Use in New Project
							</button>
						{/if}
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
