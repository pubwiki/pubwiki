<script lang="ts">
	import { useAuth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { createApiClient } from '@pubwiki/api/client';
	import type { ArtifactListItem, UserProjectListItem, Pagination } from '@pubwiki/api';

	const API_BASE_URL = 'http://localhost:8787/api';

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

	// Redirect if not authenticated
	$effect(() => {
		if (browser && !auth.isAuthenticated) {
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

	function getClient() {
		return createApiClient(API_BASE_URL, auth.token.value ?? undefined);
	}

	async function fetchArtifacts(page = 1) {
		if (!auth.currentUser) return;
		
		artifactsLoading = true;
		try {
			const client = getClient();
			const { data } = await client.GET('/users/{userId}/artifacts', {
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
			const client = getClient();
			const { data } = await client.GET('/users/{userId}/projects', {
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
			message = 'Profile updated successfully';
		} else {
			error = result.error || 'Update failed';
		}

		isSubmitting = false;
	}

	function formatDate(dateString: string): string {
		return new Date(dateString).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	const tabs: { id: TabType; label: string; icon: string }[] = [
		{ id: 'artifacts', label: 'Artifacts', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
		{ id: 'projects', label: 'Projects', icon: 'M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z' },
		{ id: 'profile', label: 'Profile', icon: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z' }
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
					{#each tabs as tab}
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
								{tab.label}
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
							<h2 class="text-lg font-semibold text-gray-900">Your Artifacts</h2>
						</div>
						
						{#if artifactsLoading}
							<div class="p-8 text-center text-gray-500">Loading...</div>
						{:else if artifacts.length === 0}
							<div class="p-8 text-center text-gray-500">
								<svg class="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
								</svg>
								<p>You haven't created any artifacts yet.</p>
								<a href="/studio" class="inline-block mt-4 px-4 py-2 bg-[#2da44e] text-white text-sm font-medium rounded-lg hover:bg-[#2c974b] transition">
									Create your first artifact
								</a>
							</div>
						{:else}
							<ul class="divide-y divide-gray-100">
								{#each artifacts as artifact}
									<li>
										<a href="/artifact/{artifact.id}" class="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
											<img 
												src={artifact.thumbnailUrl || 'https://placehold.co/48x48/222/fff?text=?'}
												alt={artifact.name}
												class="w-12 h-12 rounded object-cover border border-gray-200"
											/>
											<div class="flex-1 min-w-0">
												<h3 class="text-sm font-semibold text-gray-900 hover:text-[#0969da] truncate">{artifact.name}</h3>
												<p class="text-xs text-gray-500 truncate">{artifact.description || 'No description'}</p>
											</div>
											<div class="text-right shrink-0">
												<span class="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">{artifact.type}</span>
												<p class="text-xs text-gray-400 mt-1">{formatDate(artifact.createdAt)}</p>
											</div>
										</a>
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
										Previous
									</button>
									<span class="px-3 py-1 text-sm text-gray-600">
										Page {artifactsPagination.page} of {artifactsPagination.totalPages}
									</span>
									<button
										onclick={() => fetchArtifacts(artifactsPagination!.page + 1)}
										disabled={artifactsPagination.page >= artifactsPagination.totalPages}
										class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										Next
									</button>
								</div>
							{/if}
						{/if}
					</div>

				{:else if activeTab === 'projects'}
					<!-- Projects List -->
					<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
						<div class="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
							<h2 class="text-lg font-semibold text-gray-900">Your Projects</h2>
							<a 
								href="/me/create-project" 
								class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-[#2da44e] hover:bg-[#2c974b] rounded-lg transition"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
								</svg>
								New Project
							</a>
						</div>
						
						{#if projectsLoading}
							<div class="p-8 text-center text-gray-500">Loading...</div>
						{:else if projects.length === 0}
							<div class="p-8 text-center text-gray-500">
								<svg class="w-12 h-12 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
								</svg>
								<p>You don't have any projects yet.</p>
								<a href="/me/create-project" class="inline-block mt-4 px-4 py-2 bg-[#2da44e] text-white text-sm font-medium rounded-lg hover:bg-[#2c974b] transition">
									Create your first project
								</a>
							</div>
						{:else}
							<ul class="divide-y divide-gray-100">
								{#each projects as project}
									<li>
										<a href="/project/{project.id}" class="flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition">
											<div class="w-12 h-12 rounded bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold text-lg">
												{project.name.charAt(0).toUpperCase()}
											</div>
											<div class="flex-1 min-w-0">
												<div class="flex items-center gap-2">
													<h3 class="text-sm font-semibold text-gray-900 hover:text-[#0969da] truncate">{project.name}</h3>
													<span class="inline-block px-1.5 py-0.5 text-[10px] font-medium rounded bg-blue-100 text-blue-700">
														{project.role}
													</span>
												</div>
												<p class="text-xs text-gray-500 truncate">#{project.topic} · {project.description || 'No description'}</p>
											</div>
											<div class="text-right shrink-0">
												<span class="inline-block px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">{project.visibility}</span>
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
										Previous
									</button>
									<span class="px-3 py-1 text-sm text-gray-600">
										Page {projectsPagination.page} of {projectsPagination.totalPages}
									</span>
									<button
										onclick={() => fetchProjects(projectsPagination!.page + 1)}
										disabled={projectsPagination.page >= projectsPagination.totalPages}
										class="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
									>
										Next
									</button>
								</div>
							{/if}
						{/if}
					</div>

				{:else if activeTab === 'profile'}
					<!-- Profile Form -->
					<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
						<div class="px-4 py-3 border-b border-gray-200">
							<h2 class="text-lg font-semibold text-gray-900">Public Profile</h2>
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
											Name
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
											Your name may appear around PubWiki where you contribute or are mentioned.
										</p>
									</div>

									<div class="sm:col-span-6">
										<label for="bio" class="block text-sm font-medium text-gray-700">
											Bio
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
											Tell us a little bit about yourself.
										</p>
									</div>

									<div class="sm:col-span-6">
										<label for="website" class="block text-sm font-medium text-gray-700">
											URL
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
											Location
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
											Avatar URL
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
											{isSubmitting ? 'Saving...' : 'Update profile'}
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
