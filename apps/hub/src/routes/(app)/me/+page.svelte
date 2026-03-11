<script lang="ts">
	import { useAuth } from '@pubwiki/ui/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { ArtifactListItem, UserProjectListItem, Pagination } from '@pubwiki/api';
	import { apiClient } from '$lib/api';
	import * as m from '$lib/paraglide/messages';
	import ArtifactEditModal from '$lib/components/ArtifactEditModal.svelte';
	import ArtifactDeleteModal from '$lib/components/ArtifactDeleteModal.svelte';

	const auth = useAuth();

	// Tab state
	type TabType = 'artifacts' | 'projects' | 'profile';
	let activeTab = $state<TabType>('artifacts');

	// Artifacts tab state
	let artifacts = $state<ArtifactListItem[]>([]);
	let artifactsLoading = $state(false);
	let artifactsPagination = $state<Pagination | null>(null);
	let artifactsLoaded = $state(false);

	// Projects tab state
	let projects = $state<UserProjectListItem[]>([]);
	let projectsLoading = $state(false);
	let projectsPagination = $state<Pagination | null>(null);
	let projectsLoaded = $state(false);

	// Profile tab state
	let displayName = $state('');
	let bio = $state('');
	let website = $state('');
	let location = $state('');
	let avatarUrl = $state('');
	let message = $state('');
	let error = $state('');
	let isSubmitting = $state(false);
	let profileInitialized = false;

	// Artifact management modal state
	let editingArtifact = $state<ArtifactListItem | null>(null);
	let deletingArtifact = $state<ArtifactListItem | null>(null);

	// Redirect if not authenticated (wait for session to load first)
	$effect(() => {
		if (browser && auth.isSessionLoaded && !auth.isAuthenticated) {
			goto('/login');
		}
	});

	// Initialize profile form when user data is available
	$effect(() => {
		if (auth.currentUser && !profileInitialized) {
			displayName = auth.currentUser.displayName || '';
			bio = auth.currentUser.bio || '';
			website = auth.currentUser.website || '';
			location = auth.currentUser.location || '';
			avatarUrl = auth.currentUser.avatarUrl || '';
			profileInitialized = true;
		}
	});

	// Fetch data when tab changes
	$effect(() => {
		if (browser && auth.currentUser) {
			if (activeTab === 'artifacts' && !artifactsLoaded) {
				fetchArtifacts();
			} else if (activeTab === 'projects' && !projectsLoaded) {
				fetchProjects();
			}
		}
	});

	async function fetchArtifacts(page = 1) {
		if (!auth.currentUser) return;
		
		artifactsLoading = true;
		try {
			const { data, error } = await apiClient.GET('/users/{userId}/artifacts', {
				params: {
					path: { userId: auth.currentUser.id },
					query: { page, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }
				}
			});
			if (data) {
				artifacts = data.artifacts;
				artifactsPagination = data.pagination;
				artifactsLoaded = true;
			}
		} catch (e) {
			console.error('Failed to fetch artifacts:', e);
		} finally {
			artifactsLoading = false;
		}
	}

	async function fetchProjects(page = 1) {
		if (!auth.currentUser) return;
		
		projectsLoading = true;
		try {
			const { data } = await apiClient.GET('/users/{userId}/projects', {
				params: {
					path: { userId: auth.currentUser.id },
					query: { page, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }
				}
			});
			if (data) {
				projects = data.projects;
				projectsPagination = data.pagination;
				projectsLoaded = true;
			}
		} catch (e) {
			console.error('Failed to fetch projects:', e);
		} finally {
			projectsLoading = false;
		}
	}

	async function handleProfileSubmit(e: Event) {
		e.preventDefault();
		message = '';
		error = '';
		isSubmitting = true;

		const result = await auth.updateProfile({
			displayName: displayName || undefined,
			bio: bio || undefined,
			website: website || undefined,
			location: location || undefined,
			avatarUrl: avatarUrl || undefined
		});

		if (result.success) {
			message = m.me_profile_updated();
		} else {
			error = result.error || m.me_update_failed();
		}

		isSubmitting = false;
	}

	function handleArtifactUpdated() {
		editingArtifact = null;
		artifactsLoaded = false;
		fetchArtifacts();
	}

	function handleArtifactDeleted() {
		deletingArtifact = null;
		artifactsLoaded = false;
		fetchArtifacts();
	}

	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	const tabsConfig: { id: TabType; labelKey: () => string; icon: string }[] = [
		{ id: 'artifacts', labelKey: () => m.me_artifacts(), icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
		{ id: 'projects', labelKey: () => m.me_projects(), icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
		{ id: 'profile', labelKey: () => m.me_profile(), icon: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z' }
	];
</script>

<div class="min-h-screen bg-[#f6f8fa]">
	<div class="mx-auto max-w-[1200px] px-4 py-8">
		<!-- User Header -->
		<div class="mb-8 flex items-center gap-4">
			<img 
				src={auth.currentUser?.avatarUrl || `https://ui-avatars.com/api/?name=${auth.currentUser?.username}&background=random&size=80`}
				alt={auth.currentUser?.username}
				class="h-20 w-20 rounded-full border-2 border-white shadow"
			/>
			<div>
				<h1 class="text-2xl font-bold text-gray-900">
					{auth.currentUser?.displayName || auth.currentUser?.username}
				</h1>
				<p class="text-gray-500">@{auth.currentUser?.username}</p>
			</div>
		</div>

		<!-- Main Content -->
		<div class="flex gap-6">
			<!-- Left Sidebar - Tab Navigation -->
			<nav class="w-56 shrink-0">
				<ul class="space-y-1">
					{#each tabsConfig as tab}
						<li>
							<button
								onclick={() => activeTab = tab.id}
								class="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors
									{activeTab === tab.id 
										? 'bg-white text-gray-900 shadow-sm border border-gray-200' 
										: 'text-gray-600 hover:bg-white/50 hover:text-gray-900'}"
							>
								<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d={tab.icon} />
								</svg>
								{tab.labelKey()}
							</button>
						</li>
					{/each}
				</ul>
			</nav>

			<!-- Right Content Area -->
			<div class="flex-1 min-w-0">
				{#if activeTab === 'artifacts'}
					<!-- Artifacts List -->
					<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
						<div class="px-4 py-3 border-b border-gray-200">
							<h2 class="text-lg font-semibold text-gray-900">{m.me_your_artifacts()}</h2>
						</div>
						
						{#if artifactsLoading || !artifactsLoaded}
							<div class="p-8 text-center text-gray-500">{m.common_loading()}</div>
						{:else if artifacts.length === 0}
							<div class="p-8 text-center text-gray-500">
								<svg class="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
								</svg>
								<p>{m.me_no_artifacts()}</p>
								<a href="/studio" class="inline-block mt-4 px-4 py-2 bg-[#2da44e] text-white text-sm font-medium rounded-lg hover:bg-[#2c974b] transition">
									{m.me_create_first_artifact()}
								</a>
							</div>
						{:else}
							<ul class="divide-y divide-gray-100">
								{#each artifacts as artifact}
									<li class="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
										<a href="/artifact/{artifact.id}" class="flex items-center gap-4 flex-1 min-w-0">
											<img 
												src={artifact.thumbnailUrl || 'https://placehold.co/48x48/222/fff?text=?'}
												alt={artifact.name}
												class="w-12 h-12 rounded object-cover border border-gray-200"
											/>
											<div class="flex-1 min-w-0">
												<h3 class="text-sm font-semibold text-gray-900 hover:text-[#0969da] truncate">{artifact.name}</h3>
												<p class="text-xs text-gray-500 truncate">{artifact.description || m.common_no_description()}</p>
											</div>
											<div class="text-right shrink-0">
												{#if !artifact.isListed}
													<span class="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">Unlisted</span>
												{/if}
												<p class="text-xs text-gray-400">{formatDate(artifact.createdAt)}</p>
											</div>
										</a>
										<!-- Action buttons -->
										<div class="flex items-center gap-1 shrink-0">
											<button
												onclick={() => editingArtifact = artifact}
												class="p-1.5 text-gray-400 hover:text-[#0969da] hover:bg-blue-50 rounded transition"
												title={m.common_edit()}
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
												</svg>
											</button>
											<button
												onclick={() => deletingArtifact = artifact}
												class="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"
												title={m.common_delete()}
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
												</svg>
											</button>
										</div>
									</li>
								{/each}
							</ul>
							
							{#if artifactsPagination && artifactsPagination.totalPages > 1}
								<div class="px-4 py-3 border-t border-gray-200 flex justify-center gap-2">
									<button
										onclick={() => fetchArtifacts(artifactsPagination!.page - 1)}
										disabled={artifactsPagination.page <= 1}
										class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{m.common_previous()}
									</button>
									<span class="px-3 py-1 text-sm text-gray-600">
										{m.common_page_of({ current: artifactsPagination.page.toString(), total: artifactsPagination.totalPages.toString() })}
									</span>
									<button
										onclick={() => fetchArtifacts(artifactsPagination!.page + 1)}
										disabled={artifactsPagination.page >= artifactsPagination.totalPages}
										class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{m.common_next()}
									</button>
								</div>
							{/if}
						{/if}
					</div>

				{:else if activeTab === 'projects'}
					<!-- Projects List -->
					<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
						<div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
							<h2 class="text-lg font-semibold text-gray-900">{m.me_your_projects()}</h2>
							<a 
								href="/me/create-project" 
								class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#2da44e] hover:bg-[#2c974b] rounded-lg transition"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
								</svg>
								{m.me_new_project()}
							</a>
						</div>
						
						{#if projectsLoading || !projectsLoaded}
							<div class="p-8 text-center text-gray-500">{m.common_loading()}</div>
						{:else if projects.length === 0}
							<div class="p-8 text-center text-gray-500">
								<svg class="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
								</svg>
								<p>{m.me_no_projects()}</p>
								<a href="/me/create-project" class="inline-block mt-4 px-4 py-2 bg-[#2da44e] text-white text-sm font-medium rounded-lg hover:bg-[#2c974b] transition">
									{m.me_create_first_project()}
								</a>
							</div>
						{:else}
							<ul class="divide-y divide-gray-100">
								{#each projects as project}
									<li>
										<a href="/project/{project.id}" class="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
											<div class="w-12 h-12 rounded bg-linear-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
												{project.name.charAt(0).toUpperCase()}
											</div>
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<h3 class="text-sm font-semibold text-gray-900 hover:text-[#0969da] truncate">{project.name}</h3>
												</div>
												<p class="text-xs text-gray-500 truncate">#{project.topic} · {project.description || m.common_no_description()}</p>
											</div>
											<div class="text-right shrink-0">
												{#if !project.isListed}
													<span class="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">Unlisted</span>
												{/if}
												<p class="text-xs text-gray-400 mt-1">{formatDate(project.createdAt)}</p>
											</div>
										</a>
									</li>
								{/each}
							</ul>
							
							{#if projectsPagination && projectsPagination.totalPages > 1}
								<div class="px-4 py-3 border-t border-gray-200 flex justify-center gap-2">
									<button
										onclick={() => fetchProjects(projectsPagination!.page - 1)}
										disabled={projectsPagination.page <= 1}
										class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{m.common_previous()}
									</button>
									<span class="px-3 py-1 text-sm text-gray-600">
										{m.common_page_of({ current: projectsPagination.page.toString(), total: projectsPagination.totalPages.toString() })}
									</span>
									<button
										onclick={() => fetchProjects(projectsPagination!.page + 1)}
										disabled={projectsPagination.page >= projectsPagination.totalPages}
										class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										{m.common_next()}
									</button>
								</div>
							{/if}
						{/if}
					</div>

				{:else if activeTab === 'profile'}
					<!-- Profile Form -->
					<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
						<div class="px-4 py-3 border-b border-gray-200">
							<h2 class="text-lg font-semibold text-gray-900">{m.me_public_profile()}</h2>
						</div>
						
						<div class="p-6">
							{#if message}
								<div class="mb-4 p-3 bg-green-50 border border-green-200 rounded-md text-green-700 text-sm">
									{message}
								</div>
							{/if}

							{#if error}
								<div class="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
									{error}
								</div>
							{/if}

							<form onsubmit={handleProfileSubmit} class="space-y-6">
								<div class="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-6">
									<div class="sm:col-span-6">
										<label for="displayName" class="block text-sm font-medium text-gray-700">
											{m.me_name()}
										</label>
										<div class="mt-1">
											<input
												type="text"
												name="displayName"
												id="displayName"
												bind:value={displayName}
												class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
											/>
										</div>
										<p class="mt-2 text-sm text-gray-500">
											{m.me_name_help()}
										</p>
									</div>

									<div class="sm:col-span-6">
										<label for="bio" class="block text-sm font-medium text-gray-700">
											{m.me_bio()}
										</label>
										<div class="mt-1">
											<textarea
												id="bio"
												name="bio"
												rows="3"
												bind:value={bio}
												class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border border-gray-300 rounded-md px-3 py-2"
											></textarea>
										</div>
										<p class="mt-2 text-sm text-gray-500">
											{m.me_bio_help()}
										</p>
									</div>

									<div class="sm:col-span-6">
										<label for="website" class="block text-sm font-medium text-gray-700">
											{m.me_url()}
										</label>
										<div class="mt-1">
											<input
												type="url"
												name="website"
												id="website"
												bind:value={website}
												class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
											/>
										</div>
									</div>

									<div class="sm:col-span-6">
										<label for="location" class="block text-sm font-medium text-gray-700">
											{m.me_location()}
										</label>
										<div class="mt-1">
											<input
												type="text"
												name="location"
												id="location"
												bind:value={location}
												class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
											/>
										</div>
									</div>
									
									<div class="sm:col-span-6">
										<label for="avatarUrl" class="block text-sm font-medium text-gray-700">
											{m.me_avatar_url()}
										</label>
										<div class="mt-1 flex items-center gap-4">
											<img 
												src={avatarUrl || `https://ui-avatars.com/api/?name=${auth.currentUser?.username}&background=random`} 
												alt="Avatar preview" 
												class="h-12 w-12 rounded-full"
											/>
											<input
												type="url"
												name="avatarUrl"
												id="avatarUrl"
												bind:value={avatarUrl}
												class="shadow-sm focus:ring-[#0969da] focus:border-[#0969da] block w-full sm:text-sm border-gray-300 rounded-md px-3 py-2 border"
											/>
										</div>
									</div>
								</div>

								<div class="pt-5">
									<div class="flex justify-end">
										<button
											type="submit"
											disabled={isSubmitting}
											class="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-[#2da44e] hover:bg-[#2c974b] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2da44e] disabled:opacity-50"
										>
											{isSubmitting ? m.me_saving() : m.me_update_profile()}
										</button>
									</div>
								</div>
							</form>
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<!-- Artifact Management Modals -->
{#if editingArtifact}
	<ArtifactEditModal
		artifact={editingArtifact}
		onclose={() => editingArtifact = null}
		onupdated={handleArtifactUpdated}
	/>
{/if}

{#if deletingArtifact}
	<ArtifactDeleteModal
		artifact={deletingArtifact}
		onclose={() => deletingArtifact = null}
		ondeleted={handleArtifactDeleted}
	/>
{/if}
