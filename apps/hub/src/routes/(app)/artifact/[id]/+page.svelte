<script lang="ts">
	import type { PageData } from './$types';
	import type { ArticleDetail } from '@pubwiki/api';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { untrack } from 'svelte';
	import { useArtifactStore, type ArtifactDetails, type ArtifactGraphData } from '$lib/stores/artifacts.svelte';
	import { useArticleStore } from '$lib/stores/articles.svelte';
	import ArtifactCard from '$lib/components/ArtifactCard.svelte';
	import ArticleCard from '$lib/components/ArticleCard.svelte';
	import LineageGraph from '$lib/components/LineageGraph.svelte';
	import NodeCard from '$lib/components/NodeCard.svelte';
	import { PUBLIC_STUDIO_URL, PUBLIC_PLAY_URL } from '$env/static/public';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props<{ data: PageData }>();
	
	const artifactStore = useArtifactStore();
	const articleStore = useArticleStore();
	
	// Studio URL - defaults to localhost for development
	const studioUrl = PUBLIC_STUDIO_URL || 'http://localhost:5174';
	// Player URL - defaults to localhost for development
	const playUrl = PUBLIC_PLAY_URL || 'http://localhost:5175';
	
	let details = $state<ArtifactDetails | null>(null);
	let loading = $state(true);
	let error = $state<string | null>(null);
	
	// Version state
	let currentVersion = $state<string>('latest');
	let currentGraph = $state<ArtifactGraphData | null>(null);
	let versionLoading = $state(false);
	
	// Articles state - using Promise for {#await} pattern
	let articlesPromise = $state<Promise<ArticleDetail[]> | null>(null);

	/**
	 * Open artifact in Studio (new project)
	 */
	function handleUseArtifact() {
		if (!artifact) return;
		// Open Studio with artifact import parameter
		window.open(`${studioUrl}?import=${artifact.id}`, '_blank');
	}

	/**
	 * Open artifact in Studio (add to current project would require studio state)
	 * For now, just redirect to studio with the artifact
	 */
	function handleAddToProject() {
		if (!artifact) return;
		// Open Studio with artifact import parameter
		window.open(`${studioUrl}?import=${artifact.id}`, '_blank');
	}

	/**
	 * Switch to a different version
	 */
	async function switchVersion(version: string) {
		if (version === currentVersion || !artifact) return;
		
		versionLoading = true;
		try {
			const graph = await artifactStore.fetchGraphByVersion(artifact.id, version);
			if (graph) {
				currentGraph = graph;
				currentVersion = version;
				// Update URL without navigation
				const url = new URL(window.location.href);
				if (version === 'latest') {
					url.searchParams.delete('version');
				} else {
					url.searchParams.set('version', version);
				}
				history.replaceState({}, '', url.toString());
			}
		} finally {
			versionLoading = false;
		}
	}

	// Fetch artifact details when component mounts or id changes
	$effect(() => {
		const artifactId = data.artifactId;
		const requestedVersion = data.version;

		// Use untrack to prevent store's internal $state changes (e.g. totalItems)
		// from re-triggering this effect and causing infinite request loops
		untrack(() => {
			loading = true;
			error = null;
			
			artifactStore.fetchArtifactDetails(artifactId).then(async (result) => {
				if (result) {
					details = result;
					currentGraph = result.graph ?? null;
					currentVersion = result.graph?.version?.commitHash ?? 'latest';
					
					// If a specific version was requested, fetch it
					if (requestedVersion && requestedVersion !== 'latest' && result.graph?.version?.commitHash !== requestedVersion) {
						const graph = await artifactStore.fetchGraphByVersion(artifactId, requestedVersion);
						if (graph) {
							currentGraph = graph;
							currentVersion = requestedVersion;
						}
					}
				} else {
					error = 'Artifact not found';
				}
				loading = false;
			}).catch((e) => {
				error = e instanceof Error ? e.message : m.artifact_not_found_message();
				loading = false;
			});
		});
	});

	let artifact = $derived(details?.artifact);
	let homepage = $derived(details?.homepage);
	let nodes = $derived(currentGraph?.nodes ?? []);
	let sandboxNodes = $derived(nodes.filter(n => n.type === 'SANDBOX'));
	let parents = $derived(details?.parents ?? []);
	let children = $derived(details?.children ?? []);
	let versionInfo = $derived(currentGraph?.version);
	let commitTags = $derived(versionInfo?.commitTags ?? []);

	let activeTab = $state('Overview');
	type TabKey = 'Overview' | 'Nodes' | 'Articles' | 'Lineage' | 'Discussion';
	const tabsConfig: { key: TabKey; label: string }[] = [
		{ key: 'Overview', label: 'Overview' },
		{ key: 'Nodes', label: 'Nodes' },
		{ key: 'Articles', label: 'Articles' },
		{ key: 'Lineage', label: 'Lineage' },
		{ key: 'Discussion', label: 'Discussion' }
	];
	
	// Load articles lazily when tab is activated (only once)
	function loadArticles() {
		if (!articlesPromise && artifact) {
			articlesPromise = articleStore.fetchArticlesByArtifact(artifact.id)
				.then(result => result?.articles ?? []);
		}
	}
	
	// Handle tab change
	function handleTabChange(tab: TabKey) {
		activeTab = tab;
		if (tab === 'Articles') {
			loadArticles();
		}
	}

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
			<h1 class="text-2xl font-bold text-gray-900 mb-2">{m.artifact_not_found()}</h1>
			<p class="text-gray-600 mb-4">{error || m.artifact_not_found_message()}</p>
			<button onclick={() => goto('/')} class="text-[#0969da] hover:underline">
				{m.artifact_go_back()}
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
					{#if !artifact.isListed}
						<span class="px-2 py-0.5 text-xs border border-gray-300 rounded-full text-gray-500 ml-2">
							Unlisted
						</span>
					{/if}
					
					<!-- Version Selector -->
					{#if versionInfo}
						<div class="ml-4 flex items-center gap-2">
							<span class="text-gray-400">|</span>
							<div class="relative">
								<button 
									class="flex items-center gap-1.5 px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded border border-gray-300 transition-colors"
									onclick={(e) => {
										const menu = e.currentTarget.nextElementSibling as HTMLElement;
										menu.classList.toggle('hidden');
									}}
								>
									<svg class="w-3.5 h-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
									</svg>
									<span class="font-mono">{versionInfo.commitHash.slice(0, 8)}</span>
									{#if commitTags.length > 0}
										<span class="text-[#0969da] font-medium">({commitTags[0]})</span>
									{/if}
									<svg class="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								
								<!-- Version Dropdown Menu -->
								<div class="hidden absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-50 min-w-[200px]">
									<div class="py-1">
										<button
											onclick={() => switchVersion('latest')}
											class="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between {currentVersion === 'latest' ? 'bg-blue-50 text-blue-700' : ''}"
										>
											<span>Latest</span>
											{#if currentVersion === 'latest'}
												<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
											{/if}
										</button>
										{#each commitTags as tag}
											<button
												onclick={() => switchVersion(tag)}
												class="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center justify-between {currentVersion === tag ? 'bg-blue-50 text-blue-700' : ''}"
											>
												<span>{tag}</span>
												{#if currentVersion === tag}
													<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" /></svg>
												{/if}
											</button>
										{/each}
									</div>
								</div>
							</div>
							{#if versionLoading}
								<div class="animate-spin rounded-full h-3 w-3 border-b-2 border-[#0969da]"></div>
							{/if}
						</div>
					{/if}
				</div>
				
				<!-- User Profile / Actions placeholder -->
				<div class="flex items-center gap-4">
					<!-- Star Button -->
					<div class="flex items-center bg-white border border-gray-300 rounded-md text-xs overflow-hidden shadow-sm">
						<button class="px-3 py-1 font-semibold flex items-center gap-1 hover:bg-gray-50 transition">
							<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
							{m.artifact_star()}
						</button>
						<div class="px-2 py-1 bg-gray-50 border-l border-gray-300 font-bold text-gray-700">
							{(artifact.stats?.favCount ?? 0).toLocaleString()}
						</div>
					</div>

					<!-- Fork Button -->
					<div class="flex items-center bg-white border border-gray-300 rounded-md text-xs overflow-hidden shadow-sm">
						<button class="px-3 py-1 font-semibold flex items-center gap-1 hover:bg-gray-50 transition">
							<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>
							{m.artifact_fork()}
						</button>
						<div class="px-2 py-1 bg-gray-50 border-l border-gray-300 font-bold text-gray-700">
							{(artifact.stats?.refCount ?? 0).toLocaleString()}
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
					
					<!-- Preview Area (clickable → Play) -->
					<a href="{playUrl}/{artifact.id}" target="_blank" rel="noopener" class="block bg-black rounded-lg overflow-hidden shadow-sm border border-gray-200 aspect-video relative group">
						<img 
							src={artifact.thumbnailUrl || 'https://placehold.co/800x400/222/fff?text=No+Image'} 
							alt={artifact.name} 
							class="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition duration-500" 
						/>
						<!-- Play Icon Overlay -->
						<div class="absolute inset-0 flex items-center justify-center pointer-events-none">
							<div class="bg-black/50 rounded-full p-4 opacity-0 group-hover:opacity-100 transition duration-300">
								<svg class="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
							</div>
						</div>
					</a>

					<!-- Tabs Navigation -->
					<div class="border-b border-gray-200">
						<nav class="-mb-px flex space-x-8" aria-label="Tabs">
							{#each tabsConfig as tab}
								<button
								onclick={() => handleTabChange(tab.key)}
									class="{activeTab === tab.key
										? 'border-[#fd8c73] text-gray-900'
										: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
										whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors"
								>
									{tab.label}
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
									<p class="text-gray-600">{artifact.description || m.common_no_description()}</p>
								</div>
							{/if}
						{:else if activeTab === 'Nodes'}
							<div>
								<div class="flex items-center justify-between mb-4">
									<h3 class="font-bold text-gray-700">{m.artifact_nodes()}</h3>
									<span class="text-xs text-gray-500">{m.artifact_nodes_count({ count: nodes.length.toString() })}</span>
								</div>
								
								{#if nodes.length > 0}
									<div class="flex flex-col gap-4">
										{#each nodes as node}
											<NodeCard {node} artifactId={artifact.id} />
										{/each}
									</div>
								{:else}
									<div class="text-center py-12 text-gray-500 bg-gray-50 rounded border border-dashed border-gray-300">
										{m.artifact_no_nodes()}
									</div>
								{/if}
							</div>
						{:else if activeTab === 'Articles'}
							<div>
								{#if articlesPromise}
									{#await articlesPromise}
										<!-- Loading state -->
										<div class="flex items-center justify-center py-12">
											<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
										</div>
									{:then articles}
										<!-- Success state -->
										<div class="flex items-center justify-between mb-4">
											<h3 class="font-bold text-gray-700">Articles</h3>
											<span class="text-xs text-gray-500">{articles.length} articles</span>
										</div>
										{#if articles.length > 0}
											<div class="flex flex-col gap-3">
												{#each articles as article}
													<ArticleCard {article} />
												{/each}
											</div>
										{:else if sandboxNodes.length === 0}
											<div class="text-center py-12 text-gray-500 bg-gray-50 rounded border border-dashed border-gray-300">
												This artifact has no sandbox nodes. Articles require sandbox nodes to associate game state.
											</div>
										{:else}
											<div class="text-center py-12 text-gray-500 bg-gray-50 rounded border border-dashed border-gray-300">
												No articles available.
											</div>
										{/if}
									{:catch}
										<!-- Error state -->
										<div class="text-center py-12 text-red-500 bg-red-50 rounded border border-dashed border-red-300">
											Failed to load articles.
										</div>
									{/await}
								{:else}
									<!-- Initial state before loading triggered -->
									<div class="flex items-center justify-center py-12">
										<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
									</div>
								{/if}
							</div>
						{:else if activeTab === 'Lineage'}
							{#if browser && (parents.length > 0 || children.length > 0)}
								<LineageGraph {artifact} {parents} {children} />
							{:else}
								<div class="text-center py-12 text-gray-500">
									{m.artifact_no_lineage()}
								</div>
							{/if}
						{:else}
							<div class="text-center py-12 text-gray-500">
								{m.artifact_no_discussions()}
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

						<p class="text-sm text-gray-700 mb-4 leading-relaxed">{artifact.description || m.common_no_description()}</p>

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
								<span>{m.artifact_views({ count: (artifact.stats?.viewCount ?? 0).toLocaleString() })}</span>
							</div>
							<div class="flex items-center gap-2 text-gray-600">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
								<span>{m.artifact_downloads({ count: (artifact.stats?.downloadCount ?? 0).toLocaleString() })}</span>
							</div>
						</div>
					</div>

					<!-- 2. Action Buttons -->
					<div class="space-y-2">
						<!-- Play button -->
						<a 
							href="{playUrl}/{artifact.id}"
							target="_blank"
							rel="noopener"
							class="w-full bg-[#2da44e] hover:bg-[#218838] text-white py-2.5 px-4 rounded-md font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
						>
							<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
							{m.artifact_play()}
						</a>
						<!-- Open in Studio button -->
						<button 
							onclick={handleUseArtifact}
							class="w-full bg-[#0969da] hover:bg-[#0a53be] text-white py-2.5 px-4 rounded-md font-semibold text-sm shadow-sm transition-colors flex items-center justify-center gap-2"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
							{m.artifact_use()}
						</button>
					</div>

					<!-- 3. Parents (Dependencies) -->
					{#if parents.length > 0}
						<div>
							<h3 class="font-bold text-gray-900 mb-3 flex items-center gap-2">
								{m.artifact_dependencies()}
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
								{m.artifact_used_by()}
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
