<script lang="ts">
	import type { PageData } from './$types';
	import { createApiClient } from '@pubwiki/api/client';
	import type { ProjectDetail, ProjectArtifact, ProjectRole } from '@pubwiki/api';
	import { ItemTree, buildTree, type TreeNode } from '$lib/components/ItemTree';
	import { goto } from '$app/navigation';
	import { API_BASE_URL } from '$lib/config';

	let { data } = $props<{ data: PageData }>();

	const client = createApiClient(API_BASE_URL);

	let project = $state<ProjectDetail | null>(null);
	let homepage = $state<string | null>(null);
	let loading = $state(true);
	let homepageLoading = $state(false);
	let error = $state<string | null>(null);

	let activeTab = $state<'homepage' | 'links' | 'info'>('homepage');
	
	// Role tree node data containing the artifacts for that role
	interface RoleNodeData {
		role: ProjectRole;
		artifacts: ProjectArtifact[];
	}
	
	let selectedNode = $state<TreeNode<RoleNodeData> | null>(null);

	// Build role tree from project data
	const roleTree = $derived.by(() => {
		if (!project) return [];
		
		// Create a map of roleId to artifacts
		const roleArtifactsMap = new Map<string, ProjectArtifact[]>();
		for (const pa of project.artifacts) {
			if (pa.role) {
				const existing = roleArtifactsMap.get(pa.role.id) || [];
				existing.push(pa);
				roleArtifactsMap.set(pa.role.id, existing);
			}
		}
		
		return buildTree<ProjectRole, RoleNodeData>(project.roles, {
			getId: (role) => role.id,
			getLabel: (role) => role.name,
			getParentId: (role) => role.parentRoleId,
			isLeaf: (role) => role.isLeaf,
			getData: (role) => ({
				role,
				artifacts: roleArtifactsMap.get(role.id) || []
			})
		});
	});

	// Fetch project details
	$effect(() => {
		const projectId = data.projectId;
		loading = true;
		error = null;

		client.GET('/projects/{projectId}', {
			params: { path: { projectId } }
		}).then(({ data: result, error: apiError }) => {
			if (result) {
				project = result;
				// Fetch homepage after project loads
				fetchHomepage(projectId);
			} else {
				error = apiError?.error || 'Project not found';
			}
			loading = false;
		}).catch((e) => {
			error = e instanceof Error ? e.message : 'Failed to load project';
			loading = false;
		});
	});

	async function fetchHomepage(projectId: string) {
		homepageLoading = true;
		try {
			const response = await fetch(`${API_BASE_URL}/projects/${projectId}/homepage`);
			if (response.ok) {
				homepage = await response.text();
			} else {
				homepage = null;
			}
		} catch {
			homepage = null;
		} finally {
			homepageLoading = false;
		}
	}

	function handleNodeSelect(node: TreeNode<RoleNodeData>) {
		selectedNode = node;
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
	}

	// Get cover images or use placeholders
	function getCoverImages(proj: ProjectDetail): string[] {
		if (proj.coverUrls && proj.coverUrls.length > 0) {
			return proj.coverUrls;
		}
		// Use picsum photos as placeholders
		return [
			`https://picsum.photos/seed/${proj.id}-0/400/300`,
			`https://picsum.photos/seed/${proj.id}-1/400/300`,
			`https://picsum.photos/seed/${proj.id}-2/400/300`,
			`https://picsum.photos/seed/${proj.id}-3/400/300`
		];
	}
</script>

{#if loading}
	<div class="min-h-screen bg-[#f6f8fa] flex items-center justify-center">
		<div class="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0969da]"></div>
	</div>
{:else if error || !project}
	<div class="min-h-screen bg-[#f6f8fa] flex items-center justify-center">
		<div class="text-center">
			<h1 class="text-2xl font-bold text-gray-900 mb-2">Not Found</h1>
			<p class="text-gray-600 mb-4">{error || 'Project not found'}</p>
			<button onclick={() => goto('/community')} class="text-[#0969da] hover:underline">
				Back to Community
			</button>
		</div>
	</div>
{:else}
	<div class="min-h-screen bg-[#f6f8fa] pb-12 font-sans">
		<div class="mx-auto max-w-[1200px] px-4 pt-6">
			<!-- Header Banner with Images -->
			<div class="relative bg-gray-800 overflow-hidden rounded-xl shadow-lg" style="height: 224px;">
				<!-- Background Image Grid -->
				<div class="absolute inset-0 grid grid-cols-4 gap-px" style="z-index: 1;">
					{#each getCoverImages(project) as imageUrl}
						<img 
							src={imageUrl} 
							alt="" 
							class="w-full h-full object-cover"
						/>
					{/each}
				</div>
				
				<!-- Gradient Overlay -->
				<div class="absolute inset-0" style="z-index: 2; background: linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0.4), transparent);"></div>
				
				<!-- Project Title & Info -->
				<div class="absolute bottom-0 left-0 right-0 p-6" style="z-index: 3;">
					<div class="flex items-center gap-3 mb-2">
						<span class="text-sm text-gray-300">
							{project.visibility}
						</span>
						{#if project.isArchived}
							<span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
								Archived
							</span>
						{/if}
					</div>
					<h1 class="text-3xl font-bold text-white mb-1 drop-shadow-lg">
						{project.name}
					</h1>
					{#if project.description}
						<p class="text-gray-200 max-w-2xl drop-shadow-md">
							{project.description}
						</p>
					{/if}
					<div class="flex items-center gap-4 mt-3 text-sm text-gray-300">
						<div class="flex items-center gap-2">
							<div class="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white">
								{(project.owner.displayName || project.owner.username)[0].toUpperCase()}
							</div>
							<span class="font-medium text-white">
								{project.owner.displayName || project.owner.username}
							</span>
						</div>
						<span class="text-gray-400">•</span>
						<span>{project.artifacts.length} artifacts</span>
						<span class="text-gray-400">•</span>
						<span>{project.maintainers.length + 1} maintainers</span>
						<span class="text-gray-400">•</span>
						<span>Updated {formatDate(project.updatedAt)}</span>
					</div>
				</div>
			</div>

			<!-- Tab Navigation -->
			<div class="border-b border-gray-200 mt-4">
				<nav class="flex space-x-8" aria-label="Tabs">
					<button
						onclick={() => activeTab = 'homepage'}
						class="{activeTab === 'homepage'
							? 'border-[#0969da] text-[#0969da]'
							: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
							whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
						</svg>
						Homepage
					</button>
					<button
						onclick={() => activeTab = 'links'}
						class="{activeTab === 'links'
							? 'border-[#0969da] text-[#0969da]'
							: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
							whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
						</svg>
						Links
					</button>
					<button
						onclick={() => activeTab = 'info'}
						class="{activeTab === 'info'
							? 'border-[#0969da] text-[#0969da]'
							: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
							whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
						Project Info
					</button>
				</nav>
			</div>

			<!-- Tab Content -->
			<div class="py-6">
				{#if activeTab === 'homepage'}
					<div class="min-h-[400px]">
						{#if homepageLoading}
							<div class="flex justify-center py-12">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
							</div>
						{:else if homepage}
							<div class="prose max-w-none project-homepage">
								{@html homepage}
							</div>
						{:else}
							<div class="text-center py-12 text-gray-500">
								<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
								<p class="text-lg font-medium">No homepage yet</p>
							<p class="text-sm mt-1">This project hasn't created a homepage.</p>
						</div>
					{/if}
				</div>

			{:else if activeTab === 'links'}
				<!-- Links Tab with Role Tree and Artifact Display -->
				<div class="flex gap-6 min-h-[500px]">
					<!-- Role Tree Sidebar -->
					<div class="w-64 shrink-0 bg-white rounded-lg border border-gray-200 overflow-hidden">
						<div class="px-4 py-3 border-b border-gray-200 bg-gray-50">
							<h3 class="font-medium text-gray-900 text-sm flex items-center gap-2">
								<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
								</svg>
								Roles
							</h3>
						</div>
						<div class="overflow-y-auto max-h-[calc(500px-52px)]">
							<ItemTree 
								tree={roleTree}
								selectedId={selectedNode?.id}
								onLeafClick={handleNodeSelect}
								emptyMessage="No roles defined"
							>
								{#snippet badge(node)}
									{#if node.isLeaf && node.data?.artifacts.length}
										<span class="px-1.5 py-0.5 text-xs rounded-full bg-blue-100 text-blue-700">
											{node.data.artifacts.length}
										</span>
									{/if}
								{/snippet}
								{#snippet leafIcon(node)}
									<span class="w-4 h-4 flex items-center justify-center">
										{#if node.data?.artifacts.length}
											<svg class="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
											</svg>
										{:else}
											<svg class="w-3 h-3 text-gray-300" fill="currentColor" viewBox="0 0 24 24">
												<circle cx="12" cy="12" r="4" />
											</svg>
										{/if}
									</span>
								{/snippet}
							</ItemTree>
						</div>
					</div>

					<!-- Artifact Display Area -->
					<div class="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
						{#if selectedNode?.data}
							{@const nodeData = selectedNode.data}
							<!-- Header -->
							<div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
								<h3 class="font-medium text-gray-900 flex items-center gap-2">
									<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
									</svg>
									{selectedNode.label}
								</h3>
								<span class="text-sm text-gray-500">
									{nodeData.artifacts.length} artifact{nodeData.artifacts.length !== 1 ? 's' : ''}
								</span>
							</div>

							<!-- Artifacts List -->
							<div class="flex-1 overflow-y-auto p-4">
								{#if nodeData.artifacts.length === 0}
									<div class="text-center py-12 text-gray-500">
										<svg class="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
										</svg>
										<p class="text-sm">No artifacts assigned to this role</p>
									</div>
								{:else}
									<div class="space-y-4">
										{#each nodeData.artifacts as pa (pa.artifact.id)}
											{@const artifact = pa.artifact}
											<a 
												href="/artifact/{artifact.id}" 
												class="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition group"
											>
												<div class="flex gap-4">
													<!-- Thumbnail -->
													<div class="w-20 h-20 rounded-lg overflow-hidden shrink-0 border border-gray-100">
														<img 
															src={artifact.thumbnailUrl || 'https://placehold.co/80x80/f3f4f6/9ca3af?text=?'} 
															alt={artifact.name}
															class="w-full h-full object-cover group-hover:scale-105 transition-transform"
														/>
													</div>

													<!-- Info -->
													<div class="flex-1 min-w-0">
														<div class="flex items-start justify-between gap-2">
															<h4 class="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors truncate">
																{artifact.name}
															</h4>
															<span class="shrink-0 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
																{artifact.type}
															</span>
														</div>

														{#if artifact.description}
															<p class="text-sm text-gray-600 mt-1 line-clamp-2">
																{artifact.description}
															</p>
														{/if}

														<div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
															<span class="flex items-center gap-1">
																{artifact.author?.displayName || artifact.author?.username || 'Unknown'}
															</span>
															{#if pa.isOfficial}
																<span class="flex items-center gap-1 text-green-600">
																	<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
																		<path fill-rule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
																	</svg>
																	Official
																</span>
															{/if}
														</div>
													</div>
												</div>
											</a>
										{/each}
									</div>
								{/if}
							</div>
						{:else}
							<div class="h-full flex items-center justify-center text-gray-500">
								<div class="text-center">
									<svg class="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 9l4-4 4 4m0 6l-4 4-4-4" />
									</svg>
									<p class="text-sm font-medium">Select a role from the sidebar</p>
									<p class="text-xs mt-1 text-gray-400">Click on a leaf role to view its artifacts</p>
								</div>
							</div>
						{/if}
					</div>
				</div>

			{:else if activeTab === 'info'}
				<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
					<!-- Main Info -->
					<div class="lg:col-span-2 space-y-6">
						<!-- Project Artifacts -->
						<div class="bg-white rounded-lg border border-gray-200 p-6">
							<h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
								<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
								</svg>
								Project Artifacts
							</h3>
							{#if project.artifacts.length === 0}
								<p class="text-gray-500 text-sm">No artifacts linked to this project yet.</p>
							{:else}
								<div class="space-y-3">
									{#each project.artifacts as pa}
										<a href="/artifact/{pa.artifact.id}" class="flex items-center gap-3 p-3 rounded-lg border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition">
											<img 
												src={pa.artifact.thumbnailUrl || 'https://placehold.co/80x80/222/fff?text=No+Img'} 
												alt={pa.artifact.name}
												class="w-12 h-12 rounded object-cover"
											/>
											<div class="flex-1 min-w-0">
												<div class="font-medium text-gray-900 truncate">{pa.artifact.name}</div>
												<div class="text-xs text-gray-500 flex items-center gap-2">
													<span class="px-1.5 py-0.5 bg-gray-100 rounded">{pa.artifact.type}</span>
													{#if pa.role}
														<span class="text-blue-600">• {pa.role.name}</span>
													{/if}
												</div>
											</div>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					<!-- Sidebar -->
					<div class="space-y-6">
						<!-- Owner & Maintainers -->
						<div class="bg-white rounded-lg border border-gray-200 p-6">
							<h3 class="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wide">Team</h3>
							
							<!-- Owner -->
							<div class="mb-4">
								<div class="text-xs text-gray-500 mb-2">Owner</div>
								<div class="flex items-center gap-2">
									{#if project.owner.avatarUrl}
										<img src={project.owner.avatarUrl} alt="" class="w-8 h-8 rounded-full" />
									{:else}
										<div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500">
											{(project.owner.displayName || project.owner.username)[0].toUpperCase()}
										</div>
									{/if}
									<span class="font-medium text-gray-900">
										{project.owner.displayName || project.owner.username}
									</span>
								</div>
							</div>

							<!-- Maintainers -->
							{#if project.maintainers.length > 0}
								<div>
									<div class="text-xs text-gray-500 mb-2">Maintainers</div>
									<div class="space-y-2">
										{#each project.maintainers as maintainer}
											<div class="flex items-center gap-2">
												{#if maintainer.avatarUrl}
													<img src={maintainer.avatarUrl} alt="" class="w-6 h-6 rounded-full" />
												{:else}
													<div class="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
														{(maintainer.displayName || maintainer.username)[0].toUpperCase()}
													</div>
												{/if}
												<span class="text-sm text-gray-700">
													{maintainer.displayName || maintainer.username}
												</span>
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>

						<!-- Details -->
						<div class="bg-white rounded-lg border border-gray-200 p-6">
							<h3 class="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wide">Details</h3>
							<dl class="space-y-3 text-sm">
								{#if project.license}
									<div>
										<dt class="text-gray-500">License</dt>
										<dd class="font-medium text-gray-900">{project.license}</dd>
									</div>
								{/if}
								<div>
									<dt class="text-gray-500">Created</dt>
									<dd class="font-medium text-gray-900">{formatDate(project.createdAt)}</dd>
								</div>
								<div>
									<dt class="text-gray-500">Last Updated</dt>
									<dd class="font-medium text-gray-900">{formatDate(project.updatedAt)}</dd>
								</div>
							</dl>
						</div>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
{/if}

<style>
	:global(.project-homepage h1) {
		font-size: 1.5rem;
		line-height: 2rem;
		font-weight: 700;
		color: rgb(17 24 39);
		margin-bottom: 1rem;
	}
	:global(.project-homepage h2) {
		font-size: 1.25rem;
		line-height: 1.75rem;
		font-weight: 600;
		color: rgb(17 24 39);
		margin-bottom: 0.75rem;
		margin-top: 1.5rem;
	}
	:global(.project-homepage h3) {
		font-size: 1.125rem;
		line-height: 1.75rem;
		font-weight: 600;
		color: rgb(17 24 39);
		margin-bottom: 0.5rem;
		margin-top: 1rem;
	}
	:global(.project-homepage p) {
		color: rgb(75 85 99);
		margin-bottom: 1rem;
		line-height: 1.625;
	}
	:global(.project-homepage ul),
	:global(.project-homepage ol) {
		margin-bottom: 1rem;
		padding-left: 1.5rem;
	}
	:global(.project-homepage li) {
		color: rgb(75 85 99);
		margin-bottom: 0.25rem;
	}
	:global(.project-homepage a) {
		color: #0969da;
	}
	:global(.project-homepage a:hover) {
		text-decoration: underline;
	}
	:global(.project-homepage code) {
		background-color: rgb(243 244 246);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		font-size: 0.875rem;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	}
	:global(.project-homepage pre) {
		background-color: rgb(17 24 39);
		color: rgb(243 244 246);
		padding: 1rem;
		border-radius: 0.5rem;
		overflow-x: auto;
		margin-bottom: 1rem;
	}
	:global(.project-homepage pre code) {
		background-color: transparent;
		padding: 0;
	}
	:global(.project-homepage blockquote) {
		border-left: 4px solid rgb(229 231 235);
		padding-left: 1rem;
		font-style: italic;
		color: rgb(75 85 99);
		margin-top: 1rem;
		margin-bottom: 1rem;
	}
</style>

