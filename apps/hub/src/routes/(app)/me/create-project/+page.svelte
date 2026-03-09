<script lang="ts">
	import { useAuth } from '@pubwiki/ui/stores';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import type { ArtifactListItem } from '@pubwiki/api';
	import { apiClient } from '$lib/api';

	const auth = useAuth();

	// Form state
	let name = $state('');
	let slug = $state('');
	let topic = $state('');
	let description = $state('');
	let isListed = $state(true);
	let license = $state('');
	let homepage = $state('');

	// Artifact selection state
	let userArtifacts = $state<ArtifactListItem[]>([]);
	let selectedArtifactIds = $state<string[]>([]);
	let artifactsLoading = $state(false);
	let artifactSearchQuery = $state('');
	let artifactsLoaded = $state(false);

	// Form submission state
	let isSubmitting = $state(false);
	let error = $state('');

	// Auto-generate slug from name
	$effect(() => {
		if (name && !slug) {
			slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
		}
	});

	// Redirect if not authenticated
	$effect(() => {
		if (browser && !auth.isAuthenticated) {
			goto('/login');
		}
	});

	// Fetch user's artifacts on mount
	$effect(() => {
		if (browser && auth.currentUser && !artifactsLoaded) {
			fetchUserArtifacts();
		}
	});

	async function fetchUserArtifacts() {
		if (!auth.currentUser) return;

		artifactsLoading = true;
		try {
			const { data, error } = await apiClient.GET('/users/{userId}/artifacts', {
				params: {
					path: { userId: auth.currentUser.id },
					query: { limit: 100, sortBy: 'createdAt', sortOrder: 'desc' }
				}
			});
			if (data) {
				userArtifacts = data.artifacts;
				artifactsLoaded = true;
			}
		} catch (e) {
			console.error('Failed to fetch artifacts:', e);
		} finally {
			artifactsLoading = false;
		}
	}

	function toggleArtifact(artifactId: string) {
		if (selectedArtifactIds.includes(artifactId)) {
			selectedArtifactIds = selectedArtifactIds.filter(id => id !== artifactId);
		} else {
			selectedArtifactIds = [...selectedArtifactIds, artifactId];
		}
	}

	// Filter artifacts based on search query
	let filteredArtifacts = $derived(
		artifactSearchQuery
			? userArtifacts.filter(a => 
				a.name.toLowerCase().includes(artifactSearchQuery.toLowerCase()) ||
				a.description?.toLowerCase().includes(artifactSearchQuery.toLowerCase())
			)
			: userArtifacts
	);

	async function handleSubmit(e: Event) {
		e.preventDefault();
		error = '';

		// Validation
		if (!name.trim()) {
			error = 'Name is required';
			return;
		}
		if (!slug.trim()) {
			error = 'Slug is required';
			return;
		}
		if (!topic.trim()) {
			error = 'Topic is required';
			return;
		}
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
			error = 'Slug must be URL-friendly (lowercase letters, numbers, and hyphens only)';
			return;
		}

		isSubmitting = true;

		try {
			// Build metadata - homepage is currently not supported by the API
			// TODO: Add homepage support to the API if needed
			const metadata = {
				name: name.trim(),
				slug: slug.trim(),
				topic: topic.trim(),
				description: description.trim() || undefined,
				isListed,
				license: license.trim() || undefined,
				artifacts: selectedArtifactIds.length > 0 ? selectedArtifactIds.map(id => ({ artifactId: id, roleName: 'default' })) : undefined,
				roles: [{ name: 'default', description: 'Default role' }]
			};

			const { data, error: apiError } = await apiClient.POST('/projects', {
				body: metadata
			});

			if (data && !apiError) {
				goto(`/project/${data.project.id}`);
			} else {
				error = apiError?.error || 'Failed to create project';
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Unknown error occurred';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<div class="min-h-screen bg-[#f6f8fa]">
	<div class="mx-auto max-w-4xl px-4 py-8">
		<!-- Header -->
		<div class="mb-8">
			<a href="/me" class="text-sm text-gray-500 hover:text-[#0969da] mb-2 inline-flex items-center gap-1">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
				</svg>
				Back to profile
			</a>
			<h1 class="text-2xl font-bold text-gray-900">Create a new project</h1>
			<p class="text-gray-500 mt-1">A project groups related artifacts together under a common topic.</p>
		</div>

		{#if error}
			<div class="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
				{error}
			</div>
		{/if}

		<form onsubmit={handleSubmit} class="space-y-8">
			<!-- Basic Info Section -->
			<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
				<div class="px-6 py-4 border-b border-gray-200">
					<h2 class="text-lg font-semibold text-gray-900">Basic Information</h2>
				</div>
				<div class="p-6 space-y-6">
					<!-- Name -->
					<div>
						<label for="name" class="block text-sm font-medium text-gray-700 mb-1">
							Project Name <span class="text-red-500">*</span>
						</label>
						<input
							type="text"
							id="name"
							bind:value={name}
							placeholder="My Awesome Project"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm"
						/>
					</div>

					<!-- Slug -->
					<div>
						<label for="slug" class="block text-sm font-medium text-gray-700 mb-1">
							Slug <span class="text-red-500">*</span>
						</label>
						<input
							type="text"
							id="slug"
							bind:value={slug}
							placeholder="my-awesome-project"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm font-mono"
						/>
						<p class="mt-1 text-xs text-gray-500">URL-friendly identifier. Only lowercase letters, numbers, and hyphens.</p>
					</div>

					<!-- Topic -->
					<div>
						<label for="topic" class="block text-sm font-medium text-gray-700 mb-1">
							Topic (Hashtag) <span class="text-red-500">*</span>
						</label>
						<div class="relative">
							<span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">#</span>
							<input
								type="text"
								id="topic"
								bind:value={topic}
								placeholder="game-jam"
								class="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm"
							/>
						</div>
						<p class="mt-1 text-xs text-gray-500">The main topic or category for your project.</p>
					</div>

					<!-- Description -->
					<div>
						<label for="description" class="block text-sm font-medium text-gray-700 mb-1">
							Description
						</label>
						<textarea
							id="description"
							bind:value={description}
							rows="3"
							placeholder="A brief description of your project..."
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm resize-none"
						></textarea>
					</div>

					<!-- Visibility -->
					<div>
						<label class="flex items-center gap-2 cursor-pointer">
							<input type="checkbox" bind:checked={isListed} class="rounded text-[#0969da]" />
							<span class="text-sm text-gray-700">List in public directory</span>
						</label>
						<p class="text-xs text-gray-500 mt-1">When unchecked, the project will only be accessible via direct link.</p>
					</div>

					<!-- License -->
					<div>
						<label for="license" class="block text-sm font-medium text-gray-700 mb-1">
							License
						</label>
						<input
							type="text"
							id="license"
							bind:value={license}
							placeholder="MIT, Apache-2.0, etc."
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm"
						/>
					</div>
				</div>
			</div>

			<!-- Artifacts Section -->
			<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
				<div class="px-6 py-4 border-b border-gray-200">
					<h2 class="text-lg font-semibold text-gray-900">Artifacts</h2>
					<p class="text-sm text-gray-500 mt-1">Select artifacts to include in this project.</p>
				</div>
				<div class="p-6">
					<!-- Search -->
					<div class="mb-4">
						<input
							type="text"
							bind:value={artifactSearchQuery}
							placeholder="Search your artifacts..."
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm"
						/>
					</div>

					{#if artifactsLoading || !artifactsLoaded}
						<div class="text-center py-8 text-gray-500">Loading artifacts...</div>
					{:else if userArtifacts.length === 0}
						<div class="text-center py-8 text-gray-500">
							<p>You don't have any artifacts yet.</p>
							<a href="/studio" class="text-[#0969da] hover:underline text-sm mt-2 inline-block">Create your first artifact</a>
						</div>
					{:else if filteredArtifacts.length === 0}
						<div class="text-center py-8 text-gray-500">No artifacts match your search.</div>
					{:else}
						<div class="space-y-2 max-h-80 overflow-y-auto">
							{#each filteredArtifacts as artifact}
								<label 
									class="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition
										{selectedArtifactIds.includes(artifact.id) 
											? 'border-[#0969da] bg-blue-50' 
											: 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}"
								>
									<input
										type="checkbox"
										checked={selectedArtifactIds.includes(artifact.id)}
										onchange={() => toggleArtifact(artifact.id)}
										class="w-4 h-4 text-[#0969da] rounded border-gray-300 focus:ring-[#0969da]"
									/>
									<img 
										src={artifact.thumbnailUrl || 'https://placehold.co/40x40/222/fff?text=?'}
										alt={artifact.name}
										class="w-10 h-10 rounded object-cover border border-gray-200"
									/>
									<div class="flex-1 min-w-0">
										<h4 class="text-sm font-medium text-gray-900 truncate">{artifact.name}</h4>
										<p class="text-xs text-gray-500 truncate">{artifact.description || 'No description'}</p>
									</div>
								</label>
							{/each}
						</div>
						
						{#if selectedArtifactIds.length > 0}
							<div class="mt-4 text-sm text-gray-600">
								{selectedArtifactIds.length} artifact{selectedArtifactIds.length > 1 ? 's' : ''} selected
							</div>
						{/if}
					{/if}
				</div>
			</div>

			<!-- Homepage Section -->
			<div class="bg-white rounded-lg border border-gray-200 shadow-sm">
				<div class="px-6 py-4 border-b border-gray-200">
					<h2 class="text-lg font-semibold text-gray-900">Homepage</h2>
					<p class="text-sm text-gray-500 mt-1">Write a homepage for your project in Markdown. This will be rendered as HTML.</p>
				</div>
				<div class="p-6">
					<textarea
						bind:value={homepage}
						rows="12"
						placeholder="# Welcome to My Project

Describe your project here using Markdown...

## Features

- Feature 1
- Feature 2
- Feature 3

## Getting Started

..."
						class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#0969da] focus:border-[#0969da] text-sm font-mono resize-y"
					></textarea>
					<p class="mt-2 text-xs text-gray-500">Supports Markdown syntax including headers, lists, code blocks, and more.</p>
				</div>
			</div>

			<!-- Submit -->
			<div class="flex items-center justify-end gap-4">
				<a href="/me" class="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition">
					Cancel
				</a>
				<button
					type="submit"
					disabled={isSubmitting}
					class="px-6 py-2 text-sm font-medium text-white bg-[#2da44e] hover:bg-[#2c974b] rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{isSubmitting ? 'Creating...' : 'Create Project'}
				</button>
			</div>
		</form>
	</div>
</div>
