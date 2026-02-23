<script lang="ts">
	/**
	 * ProjectListModal - Modal for browsing local and online projects
	 * 
	 * Features:
	 * - Two tabs: Local Projects, Online Projects
	 * - Local projects from IndexedDB
	 * - Online projects from user's artifacts API
	 * - Open/Delete actions for local projects
	 * - Import online projects into local studio
	 */
	import { onMount } from 'svelte';
	import { PUBLIC_HUB_URL } from '$env/static/public';
	import { getAllProjects, deleteProject, setCurrentProject, type StoredProject } from '$lib/persistence';
	import { useAuth } from '@pubwiki/ui/stores';
	import { createApiClient } from '@pubwiki/api/client';
	import type { ArtifactListItem } from '@pubwiki/api';
	import { API_BASE_URL } from '$lib/config';
	import { importArtifactToNewProject } from '$lib/io';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		currentProjectId: string;
		onClose: () => void;
	}

	let { currentProjectId, onClose }: Props = $props();

	// Tab state
	type TabId = 'local' | 'online';
	let activeTab = $state<TabId>('local');

	// Auth state
	const auth = useAuth();
	const apiClient = createApiClient(API_BASE_URL);

	// Local projects
	let localProjects = $state<StoredProject[]>([]);
	let loadingLocal = $state(true);

	// Online projects - extends ArtifactListItem from API with local project link
	type OnlineProject = ArtifactListItem & {
		/** Local project ID if already imported */
		localProjectId?: string;
	};
	let onlineProjects = $state<OnlineProject[]>([]);
	let loadingOnline = $state(false);
	let onlineError = $state<string | null>(null);
	let onlinePage = $state(1);
	let onlineHasMore = $state(false);
	let importingId = $state<string | null>(null);

	// Load local projects
	async function loadLocalProjects() {
		loadingLocal = true;
		try {
			localProjects = await getAllProjects();
		} catch (err) {
			console.error('Failed to load local projects:', err);
			localProjects = [];
		} finally {
			loadingLocal = false;
		}
	}

	// Build a map of artifactId -> local project for quick lookup
	function getLocalArtifactMap(): Map<string, StoredProject> {
		const map = new Map<string, StoredProject>();
		for (const p of localProjects) {
			if (p.artifactId) {
				map.set(p.artifactId, p);
			}
		}
		return map;
	}

	// Load online projects from API
	async function loadOnlineProjects(page = 1) {
		if (!auth.isAuthenticated || !auth.user) return;
		
		if (page === 1) {
			loadingOnline = true;
			onlineError = null;
		}
		
		try {
			const { data, error } = await apiClient.GET('/users/{userId}/artifacts', {
				params: {
					path: { userId: auth.user.id },
					query: {
						page,
						limit: 20,
						sortBy: 'updatedAt',
						sortOrder: 'desc'
					}
				}
			});

			if (error) {
				onlineError = m.studio_projects_load_failed();
				return;
			}
			
			if (!data) {
				onlineError = m.studio_projects_load_failed();
				return;
			}

			// Ensure local projects are loaded for cross-referencing
			if (localProjects.length === 0 && !loadingLocal) {
				await loadLocalProjects();
			}
			const localMap = getLocalArtifactMap();

			const fetched: OnlineProject[] = (data.artifacts ?? []).map((a) => ({
				...a,
				localProjectId: localMap.get(a.id)?.id
			}));

			if (page === 1) {
				onlineProjects = fetched;
			} else {
				onlineProjects = [...onlineProjects, ...fetched];
			}

			onlinePage = page;
			const pagination = data.pagination;
			onlineHasMore = pagination ? pagination.page < pagination.totalPages : false;
		} catch (err) {
			console.error('Failed to load online projects:', err);
			onlineError = m.studio_projects_load_failed();
		} finally {
			loadingOnline = false;
		}
	}

	// Import an online artifact into a new local project
	async function importOnlineProject(artifact: OnlineProject) {
		if (importingId) return;
		importingId = artifact.id;

		try {
			// Fetch artifact graph data
			const { data, error } = await apiClient.GET('/artifacts/{artifactId}/graph', {
				params: { path: { artifactId: artifact.id } }
			});

			if (error || !data) {
				alert(m.studio_projects_import_failed());
				return;
			}

			// Import into a new project
			const newProjectId = await importArtifactToNewProject(data, artifact.id);

			// Navigate to the new project
			setCurrentProject(newProjectId);
			window.location.href = `/${newProjectId}`;
		} catch (err) {
			console.error('Failed to import project:', err);
			alert(m.studio_projects_import_failed());
		} finally {
			importingId = null;
		}
	}

	// Open a project
	function openProject(projectId: string) {
		setCurrentProject(projectId);
		window.location.href = `/${projectId}`;
	}

	// Delete a local project
	async function handleDeleteProject(project: StoredProject) {
		if (!confirm(m.studio_projects_delete_confirm())) {
			return;
		}

		try {
			await deleteProject(project.id);
			// Reload the list
			await loadLocalProjects();
			
			// If we deleted the current project, redirect to a new one
			if (project.id === currentProjectId) {
				const remaining = await getAllProjects();
				if (remaining.length > 0) {
					openProject(remaining[0].id);
				} else {
					// Create a new project
					const newId = crypto.randomUUID();
					setCurrentProject(newId);
					window.location.href = `/${newId}`;
				}
			}
		} catch (err) {
			console.error('Failed to delete project:', err);
		}
	}

	// Redirect to hub login
	function redirectToLogin() {
		const hubUrl = PUBLIC_HUB_URL || 'http://localhost:5173';
		window.location.href = `${hubUrl}/login`;
	}

	// Format date (for local projects - epoch ms)
	function formatDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Format ISO date string (for online projects)
	function formatISODate(dateStr: string): string {
		return new Date(dateStr).toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	// Listed badge config (API uses isListed boolean)
	function getListedConfig(isListed: boolean) {
		if (isListed) {
			return { label: m.studio_projects_visibility_public(), class: 'bg-green-100 text-green-700' };
		} else {
			return { label: m.studio_projects_visibility_unlisted(), class: 'bg-yellow-100 text-yellow-700' };
		}
	}

	// Load data on mount
	onMount(() => {
		loadLocalProjects();
	});

	// Load online projects when tab changes
	$effect(() => {
		if (activeTab === 'online' && auth.isAuthenticated) {
			loadOnlineProjects();
		}
	});

	const tabs = [
		{ id: 'local' as const, label: m.studio_projects_local() },
		{ id: 'online' as const, label: m.studio_projects_online() }
	];
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] overflow-hidden flex flex-col">
		<!-- Header -->
		<div class="px-4 py-2.5 border-b border-gray-200 flex items-center justify-between">
			<h2 class="text-lg font-semibold text-gray-900">{m.studio_projects_title()}</h2>
			<button
				type="button"
				class="text-gray-400 hover:text-gray-500 transition-colors"
				onclick={onClose}
				aria-label={m.common_cancel()}
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Content: Left tabs + Right content -->
		<div class="flex flex-1 overflow-hidden">
			<!-- Left sidebar tabs -->
			<div class="w-48 bg-gray-50 border-r border-gray-200 py-4">
				<nav class="space-y-1 px-2">
					{#each tabs as tab}
						<button
							class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
								{activeTab === tab.id
									? 'bg-blue-100 text-blue-700'
									: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}"
							onclick={() => (activeTab = tab.id)}
						>
							{#if tab.id === 'local'}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
								</svg>
							{:else}
								<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
								</svg>
							{/if}
							{tab.label}
						</button>
					{/each}
				</nav>
			</div>

			<!-- Right content area -->
			<div class="flex-1 overflow-y-auto p-4">
				{#if activeTab === 'local'}
					<!-- Local Projects -->
					{#if loadingLocal}
						<div class="flex items-center justify-center h-32">
							<div class="text-gray-500">{m.common_loading()}</div>
						</div>
					{:else if localProjects.length === 0}
						<div class="flex flex-col items-center justify-center h-32 text-gray-500">
							<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
							</svg>
							<p>{m.studio_projects_no_local()}</p>
						</div>
					{:else}
						<div class="space-y-2">
							{#each localProjects as project}
								<div
									class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors
										{project.id === currentProjectId ? 'ring-2 ring-blue-500' : ''}"
								>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<h3 class="font-medium text-gray-900 truncate">{project.name}</h3>
											{#if !project.isDraft}
												<span class="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">
													{m.studio_published()}
												</span>
											{/if}
											{#if project.id === currentProjectId}
												<span class="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
													Current
												</span>
											{/if}
										</div>
										<p class="text-xs text-gray-500 mt-1">
											{m.studio_projects_last_updated({ date: formatDate(project.updatedAt) })}
										</p>
									</div>
									<div class="flex items-center gap-2 ml-4">
										{#if project.id !== currentProjectId}
											<button
												class="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
												onclick={() => openProject(project.id)}
											>
												{m.studio_projects_open()}
											</button>
										{/if}
										<button
											class="px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded transition-colors"
											onclick={() => handleDeleteProject(project)}
										>
											{m.studio_projects_delete()}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				{:else}
					<!-- Online Projects -->
					{#if !auth.isAuthenticated}
						<div class="flex flex-col items-center justify-center h-64 text-gray-500">
							<svg class="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
							</svg>
							<p class="text-lg font-medium mb-2">{m.studio_projects_login_required()}</p>
							<button
								class="mt-4 px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
								onclick={redirectToLogin}
							>
								{m.studio_projects_login_button()}
							</button>
						</div>
					{:else if loadingOnline}
						<div class="flex items-center justify-center h-32">
							<div class="flex items-center gap-2 text-gray-500">
								<svg class="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
								</svg>
								{m.common_loading()}
							</div>
						</div>
					{:else if onlineError}
						<div class="flex flex-col items-center justify-center h-32 text-red-500">
							<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
							</svg>
							<p>{onlineError}</p>
							<button
								class="mt-3 px-4 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded transition-colors"
								onclick={() => loadOnlineProjects()}
							>
								{m.common_retry()}
							</button>
						</div>
					{:else if onlineProjects.length === 0}
						<div class="flex flex-col items-center justify-center h-32 text-gray-500">
							<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
							</svg>
							<p>{m.studio_projects_no_online()}</p>
						</div>
					{:else}
						<div class="space-y-2">
							{#each onlineProjects as project}
								{@const visCfg = getListedConfig(project.isListed)}
								<div
									class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
								>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2">
											<h3 class="font-medium text-gray-900 truncate">{project.name}</h3>
											<span class="px-1.5 py-0.5 text-xs font-medium rounded {visCfg.class}">
												{visCfg.label}
											</span>
											{#if project.localProjectId}
												<span class="px-1.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded">
													{m.studio_projects_already_local()}
												</span>
											{/if}
										</div>
										{#if project.description}
											<p class="text-xs text-gray-500 mt-0.5 truncate">{project.description}</p>
										{/if}
										<p class="text-xs text-gray-400 mt-1">
											{m.studio_projects_last_updated({ date: formatISODate(project.updatedAt) })}
										</p>
									</div>
									<div class="flex items-center gap-2 ml-4 shrink-0">
										{#if project.localProjectId}
											<!-- Already imported - open the local project -->
											<button
												class="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
												onclick={() => openProject(project.localProjectId!)}
											>
												{m.studio_projects_open()}
											</button>
										{:else}
											<!-- Not imported - download and import -->
											<button
												class="px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
												disabled={importingId !== null}
												onclick={() => importOnlineProject(project)}
											>
												{#if importingId === project.id}
													<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
														<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
														<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
													</svg>
													{m.studio_projects_importing()}
												{:else}
													<!-- Download icon -->
													<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
													</svg>
													{m.studio_projects_open()}
												{/if}
											</button>
										{/if}
									</div>
								</div>
							{/each}
						</div>

						<!-- Load More -->
						{#if onlineHasMore}
							<div class="flex justify-center mt-4">
								<button
									class="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
									onclick={() => loadOnlineProjects(onlinePage + 1)}
								>
									{m.studio_projects_load_more()}
								</button>
							</div>
						{/if}
					{/if}
				{/if}
			</div>
		</div>
	</div>
</div>
