<script lang="ts">
	import type { PageData } from './$types';
	import type { ProjectDetail, ProjectArtifact, ProjectRole, ProjectPage, ProjectPageDetail, PostListItem, PostDetail, DiscussionReplyItem } from '@pubwiki/api';
	import { ItemTree, buildTree, type TreeNode } from '$lib/components/ItemTree';
	import { goto } from '$app/navigation';
	import { apiClient } from '$lib/api';
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut, backOut } from 'svelte/easing';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props<{ data: PageData }>();

	let project = $state<ProjectDetail | null>(null);
	let homepage = $state<string | null>(null);
	let loading = $state(true);
	let homepageLoading = $state(false);
	let error = $state<string | null>(null);
	let lastProjectId = $state<string | null>(null);

	// Tab state: 'homepage' | 'links' | 'posts' | custom page id
	let activeTab = $state<string>('homepage');
	
	// Posts state - using Promise for {#await} pattern
	let postsPromise = $state<Promise<PostListItem[]> | null>(null);
	let selectedPost = $state<PostDetail | null>(null);
	let postModalOpen = $state(false);
	let postReplies = $state<DiscussionReplyItem[]>([]);
	let repliesLoading = $state(false);
	
	// Custom page content state - using Map to cache + Promise pattern
	let customPagePromises = $state<Map<string, Promise<string | null>>>(new Map());
	
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
	
	// Get custom pages (pages excluding homepage)
	const customPages = $derived.by(() => {
		if (!project) return [];
		return project.pages
			.filter(page => page.id !== project!.homepageId)
			.sort((a, b) => a.order - b.order);
	});

	// Fetch project details when projectId changes
	$effect(() => {
		const projectId = data.projectId;
		if (projectId === lastProjectId) return;
		
		lastProjectId = projectId;
		loading = true;
		error = null;
		project = null;
		homepage = null;
		postsPromise = null;
		customPagePromises = new Map();
		activeTab = 'homepage';

		apiClient.GET('/projects/{projectId}', {
			params: { path: { projectId } }
		}).then(({ data: result, error: apiError }) => {
			if (result) {
				project = result;
				// Fetch homepage after project loads
				if (result.homepageId) {
					fetchHomepage(projectId, result.homepageId);
				}
			} else {
				error = apiError?.error || 'Project not found';
			}
			loading = false;
		}).catch((e) => {
			error = e instanceof Error ? e.message : 'Failed to load project';
			loading = false;
		});
	});
	
	// Handle tab change - trigger lazy loading
	function handleTabChange(tab: string) {
		activeTab = tab;
		if (tab === 'posts' && project && !postsPromise) {
			postsPromise = fetchPosts(project.id);
		} else if (project && tab !== 'homepage' && tab !== 'links' && tab !== 'posts') {
			// Custom page - load if not cached
			if (!customPagePromises.has(tab)) {
				const promise = fetchCustomPage(project.id, tab);
				customPagePromises = new Map(customPagePromises).set(tab, promise);
			}
		}
	}

	async function fetchHomepage(projectId: string, homepageId: string) {
		homepageLoading = true;
		try {
			const { data: pageData } = await apiClient.GET('/projects/{projectId}/pages/{pageId}', {
				params: { path: { projectId, pageId: homepageId } }
			});
			if (pageData) {
				homepage = pageData.content || null;
			} else {
				homepage = null;
			}
		} catch {
			homepage = null;
		} finally {
			homepageLoading = false;
		}
	}
	
	async function fetchPosts(projectId: string): Promise<PostListItem[]> {
		const { data: result } = await apiClient.GET('/projects/{projectId}/posts', {
			params: { path: { projectId }, query: { limit: 50 } }
		});
		return result?.posts ?? [];
	}
	
	async function fetchCustomPage(projectId: string, pageId: string): Promise<string | null> {
		const { data: pageData } = await apiClient.GET('/projects/{projectId}/pages/{pageId}', {
			params: { path: { projectId, pageId } }
		});
		return pageData?.content || null;
	}
	
	async function openPostModal(post: PostListItem) {
		if (!project) return;
		postModalOpen = true;
		repliesLoading = true;
		postReplies = [];
		
		// Fetch post detail
		try {
			const { data: postDetail } = await apiClient.GET('/projects/{projectId}/posts/{postId}', {
				params: { path: { projectId: project.id, postId: post.id } }
			});
			if (postDetail) {
				selectedPost = postDetail;
				// Fetch replies if there's a discussion
				if (postDetail.discussionId) {
					const { data: repliesData } = await apiClient.GET('/discussions/{discussionId}/replies', {
						params: { path: { discussionId: postDetail.discussionId }, query: { limit: 100 } }
					});
					if (repliesData) {
						postReplies = repliesData.replies;
					}
				}
			}
		} catch {
			selectedPost = null;
		} finally {
			repliesLoading = false;
		}
	}
	
	function closePostModal() {
		postModalOpen = false;
		selectedPost = null;
		postReplies = [];
	}

	function handleNodeSelect(node: TreeNode<RoleNodeData>) {
		selectedNode = node;
	}

	function formatDate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString();
	}
	
	function formatDateTime(dateStr: string): string {
		return new Date(dateStr).toLocaleString();
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
			<h1 class="text-2xl font-bold text-gray-900 mb-2">{m.project_not_found()}</h1>
			<p class="text-gray-600 mb-4">{error || m.project_not_found_message()}</p>
			<button onclick={() => goto('/community')} class="text-[#0969da] hover:underline">
				{m.project_back_to_community()}
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
						{#if !project.isListed}
							<span class="text-sm text-gray-300">
								Unlisted
							</span>
						{/if}
						{#if project.isArchived}
							<span class="px-2 py-0.5 rounded text-xs font-medium bg-yellow-500/20 text-yellow-300 border border-yellow-500/30">
								{m.project_archived()}
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
						<span>{m.project_artifacts_count({ count: project.artifacts.length.toString() })}</span>
						<span class="text-gray-400">•</span>
						<span>{m.project_updated({ date: formatDate(project.updatedAt) })}</span>
						{#if project.license}
							<span class="text-gray-400">•</span>
							<span class="px-2 py-0.5 rounded text-xs font-medium bg-blue-500/20 text-blue-300 border border-blue-500/30">
								{project.license}
							</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- Tab Navigation -->
			<div class="border-b border-gray-200 mt-4">
				<nav class="flex space-x-8 overflow-x-auto" aria-label="Tabs">
					<button
						onclick={() => handleTabChange('homepage')}
						class="{activeTab === 'homepage'
							? 'border-[#0969da] text-[#0969da]'
							: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
							whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
						</svg>
						{m.project_homepage()}
					</button>
					<button
						onclick={() => handleTabChange('links')}
						class="{activeTab === 'links'
							? 'border-[#0969da] text-[#0969da]'
							: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
							whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
						</svg>
						{m.project_links()}
					</button>
					<button
						onclick={() => handleTabChange('posts')}
						class="{activeTab === 'posts'
							? 'border-[#0969da] text-[#0969da]'
							: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
							whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
					>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
						</svg>
						{m.project_posts()}
					</button>
					{#each customPages as page (page.id)}
						<button
							onclick={() => handleTabChange(page.id)}
							class="{activeTab === page.id
								? 'border-[#0969da] text-[#0969da]'
								: 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}
								whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors flex items-center gap-2"
						>
							{#if page.icon}
								<span>{page.icon}</span>
							{:else}
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
								</svg>
							{/if}
							{page.name}
						</button>
					{/each}
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
								<p class="text-lg font-medium">{m.project_no_homepage()}</p>
							<p class="text-sm mt-1">{m.project_no_homepage_desc()}</p>
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
								{m.project_roles()}
							</h3>
						</div>
						<div class="overflow-y-auto max-h-[calc(500px-52px)]">
							<ItemTree 
								tree={roleTree}
								selectedId={selectedNode?.id}
								onLeafClick={handleNodeSelect}
								emptyMessage={m.project_no_roles()}
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
									{m.project_artifact_count({ count: nodeData.artifacts.length.toString() })}
								</span>
							</div>

							<!-- Artifacts List -->
							<div class="flex-1 overflow-y-auto p-4">
								{#if nodeData.artifacts.length === 0}
									<div class="text-center py-12 text-gray-500">
										<svg class="mx-auto h-12 w-12 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
										</svg>
										<p class="text-sm">{m.project_no_artifacts_role()}</p>
									</div>
								{:else}
									<div class="space-y-4">
										{#each nodeData.artifacts as pa (pa.artifact.id)}
											{@const artifact = pa.artifact}
											<a 
												href="/artifact/{artifact.id}" 
												class="block bg-white rounded-lg border border-gray-200 p-4 hover:border-blue-300 hover:shadow-md transition group relative"
											>
												<!-- Official Badge at top-right -->
												{#if pa.isOfficial}
													<span class="absolute top-2 right-2 px-2 py-0.5 text-xs font-semibold rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
														{m.project_official()}
													</span>
												{/if}
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
														</div>

														{#if artifact.description}
															<p class="text-sm text-gray-600 mt-1 line-clamp-2">
																{artifact.description}
															</p>
														{/if}

														<div class="flex items-center gap-3 mt-2 text-xs text-gray-500">
															<span class="flex items-center gap-1">
																{artifact.author?.displayName || artifact.author?.username || m.project_unknown_author()}
															</span>
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
									<p class="text-sm font-medium">{m.project_select_role()}</p>
									<p class="text-xs mt-1 text-gray-400">{m.project_select_role_hint()}</p>
								</div>
							</div>
						{/if}
					</div>
				</div>

			{:else if activeTab === 'posts'}
				<!-- Posts Tab -->
				<div class="min-h-[400px] max-w-3xl mx-auto">
					{#if postsPromise}
						{#await postsPromise}
							<div class="flex justify-center py-12">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
							</div>
						{:then posts}
							{#if posts.length === 0}
								<div class="text-center py-12 text-gray-500">
									<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
									</svg>
									<p class="text-lg font-medium">{m.project_no_posts()}</p>
									<p class="text-sm mt-1">{m.project_no_posts_desc()}</p>
								</div>
							{:else}
								<div class="space-y-4">
									{#each posts as post (post.id)}
										<button 
											type="button"
											onclick={() => openPostModal(post)}
											class="w-full text-left bg-white rounded-lg border border-gray-200 overflow-hidden hover:border-blue-300 hover:shadow-md transition group"
										>
											<!-- Cover image if exists -->
											{#if post.coverUrls && post.coverUrls.length > 0}
												<div class="h-48 overflow-hidden">
													<img 
														src={post.coverUrls[0]} 
														alt=""
														class="w-full h-full object-cover group-hover:scale-105 transition-transform"
													/>
												</div>
											{/if}
											<div class="p-5">
												<!-- Pinned badge -->
												{#if post.isPinned}
													<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700 mb-2">
														<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
															<path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
														</svg>
														{m.project_pinned()}
													</span>
												{/if}
												<h3 class="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition-colors line-clamp-2">
													{post.title}
												</h3>
												<div class="mt-2 text-sm text-gray-600 line-clamp-3 prose-content">
													{@html post.content}
												</div>
												<div class="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
													<div class="flex items-center gap-2 text-sm text-gray-500">
														{#if post.author.avatarUrl}
															<img src={post.author.avatarUrl} alt="" class="w-5 h-5 rounded-full" />
														{:else}
															<div class="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500">
																{(post.author.displayName || post.author.username)[0].toUpperCase()}
															</div>
														{/if}
														<span>{post.author.displayName || post.author.username}</span>
														<span class="text-gray-400">•</span>
														<span>{formatDate(post.createdAt)}</span>
													</div>
													{#if post.replyCount && post.replyCount > 0}
														<div class="flex items-center gap-1 text-sm text-gray-500">
															<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
															</svg>
															{post.replyCount}
														</div>
													{/if}
												</div>
											</div>
										</button>
									{/each}
								</div>
							{/if}
						{:catch}
							<div class="text-center py-12 text-red-500">
								<p class="text-lg font-medium">Failed to load posts</p>
							</div>
						{/await}
					{:else}
						<div class="flex justify-center py-12">
							<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
						</div>
					{/if}
				</div>

			{:else}
				<!-- Custom Page Tab -->
				<div class="min-h-[400px]">
					{#if customPagePromises.has(activeTab)}
						{#await customPagePromises.get(activeTab)}
							<div class="flex justify-center py-12">
								<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
							</div>
						{:then content}
							{#if content}
								<div class="prose max-w-none project-homepage">
									{@html content}
								</div>
							{:else}
								<div class="text-center py-12 text-gray-500">
									<svg class="mx-auto h-12 w-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
									</svg>
									<p class="text-lg font-medium">{m.project_no_content()}</p>
									<p class="text-sm mt-1">{m.project_empty_page()}</p>
								</div>
							{/if}
						{:catch}
							<div class="text-center py-12 text-red-500">
								<p class="text-lg font-medium">Failed to load page</p>
							</div>
						{/await}
					{:else}
						<div class="flex justify-center py-12">
							<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Post Detail Modal -->
{#if postModalOpen}
	<div class="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
		<!-- Backdrop -->
		<div 
			class="fixed inset-0 bg-gray-500/75"
			transition:fade={{ duration: 200 }}
			onclick={closePostModal}
			onkeydown={(e) => e.key === 'Escape' && closePostModal()}
			role="button"
			tabindex="0"
			aria-label="Close modal"
		></div>
		
		<!-- Modal Panel -->
		<div class="flex min-h-full items-center justify-center p-4">
			<div 
				class="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col"
				transition:fly={{ y: 30, duration: 300, easing: cubicOut }}
			>
				<!-- Header -->
				<div class="flex items-center justify-between px-6 py-4 border-b border-gray-200">
					<h2 id="modal-title" class="text-lg font-semibold text-gray-900 truncate">
						{selectedPost?.title || m.common_loading()}
					</h2>
					<button
						onclick={closePostModal}
						class="text-gray-400 hover:text-gray-600 transition-colors"
						aria-label="Close modal"
					>
						<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
				
				<!-- Content -->
				<div class="flex-1 overflow-y-auto">
					{#if selectedPost}
						<!-- Post Cover -->
						{#if selectedPost.coverUrls && selectedPost.coverUrls.length > 0}
							<div class="h-64 overflow-hidden">
								<img 
									src={selectedPost.coverUrls[0]} 
									alt=""
									class="w-full h-full object-cover"
								/>
							</div>
						{/if}
						
						<!-- Post Content -->
						<div class="p-6">
							<!-- Author info -->
							<div class="flex items-center gap-3 mb-4 pb-4 border-b border-gray-100">
								{#if selectedPost.author.avatarUrl}
									<img src={selectedPost.author.avatarUrl} alt="" class="w-10 h-10 rounded-full" />
								{:else}
									<div class="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-500">
										{(selectedPost.author.displayName || selectedPost.author.username)[0].toUpperCase()}
									</div>
								{/if}
								<div>
									<div class="font-medium text-gray-900">
										{selectedPost.author.displayName || selectedPost.author.username}
									</div>
									<div class="text-sm text-gray-500">
										{formatDateTime(selectedPost.createdAt)}
									</div>
								</div>
							</div>
							
							<!-- Post body -->
							<div class="prose max-w-none project-homepage">
								{@html selectedPost.content}
							</div>
							
									<!-- Comments Section -->
									<div class="mt-8 pt-6 border-t border-gray-200">
										<h3 class="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
											<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
											</svg>
											{m.project_comments()} ({postReplies.length})
										</h3>								{#if repliesLoading}
									<div class="flex justify-center py-8">
										<div class="animate-spin rounded-full h-6 w-6 border-b-2 border-[#0969da]"></div>
									</div>
								{:else if postReplies.length === 0}
									<div class="text-center py-8 text-gray-500">
										<p class="text-sm">{m.project_no_comments()}</p>
									</div>
								{:else}
									<div class="space-y-4">
										{#each postReplies as reply (reply.id)}
											<div class="flex gap-3 p-4 rounded-lg bg-gray-50">
												{#if reply.author.avatarUrl}
													<img src={reply.author.avatarUrl} alt="" class="w-8 h-8 rounded-full shrink-0" />
												{:else}
													<div class="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">
														{(reply.author.displayName || reply.author.username)[0].toUpperCase()}
													</div>
												{/if}
												<div class="flex-1 min-w-0">
													<div class="flex items-center gap-2 mb-1">
														<span class="font-medium text-gray-900 text-sm">
															{reply.author.displayName || reply.author.username}
														</span>
														<span class="text-xs text-gray-400">
															{formatDateTime(reply.createdAt)}
														</span>
													</div>
													<div class="text-sm text-gray-700 prose-content">
														{@html reply.content}
													</div>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{:else}
						<div class="flex justify-center py-12">
							<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0969da]"></div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}
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
	/* Prose content for posts preview - strip most styling */
	:global(.prose-content p) {
		margin: 0;
		display: inline;
	}
	:global(.prose-content br) {
		display: none;
	}
	:global(.prose-content h1),
	:global(.prose-content h2),
	:global(.prose-content h3),
	:global(.prose-content h4),
	:global(.prose-content h5),
	:global(.prose-content h6) {
		font-size: inherit;
		font-weight: inherit;
		margin: 0;
		display: inline;
	}
</style>

