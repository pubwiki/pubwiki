<script lang="ts">
	/**
	 * ProjectTab - Project settings and publish functionality
	 * Replaces the PublishModal with an inline experience
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { StudioNodeData, GeneratedNodeData } from '../../utils/types';
	import type { NodeRef } from '../../stores/version';
	import type { PublishMetadata } from '../../utils/publish';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodes: Node<StudioNodeData>[];
		edges: Edge[];
		projectId: string;
		projectName: string;
		isDraft: boolean;
		isAuthenticated: boolean;
		onPublish: (metadata: PublishMetadata, nodes: Node<StudioNodeData>[], edges: Edge[]) => Promise<void>;
	}

	let { nodes, edges, projectId, projectName, isDraft, isAuthenticated, onPublish }: Props = $props();

	// Form state - initialized from props but managed locally
	let name = $state('');
	let slug = $state('');
	let description = $state('');
	let homepage = $state('');
	let artifactType: PublishMetadata['type'] = $state('RECIPE');
	let visibility: PublishMetadata['visibility'] = $state('PUBLIC');
	let version = $state('1.0.0');
	let tagsInput = $state('');
	let isSubmitting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let initialized = $state(false);

	// Category expand state
	let expandedCategories = $state<Record<string, boolean>>({
		PROMPT: true,
		INPUT: false,
		GENERATED: false
	});

	// Initialize name from projectName prop
	$effect(() => {
		if (!initialized && projectName) {
			name = projectName;
			slug = generateSlug(projectName);
			initialized = true;
		}
	});

	// Check if a NodeRef references a historical version
	function isHistoricalRef(ref: NodeRef, allNodes: Node<StudioNodeData>[]): boolean {
		const targetNode = allNodes.find((n) => n.id === ref.id);
		if (!targetNode) return true;
		return targetNode.data.commit !== ref.commit;
	}

	// Check if a generated node references any historical versions
	function referencesHistoricalVersions(
		nodeData: GeneratedNodeData,
		allNodes: Node<StudioNodeData>[]
	): boolean {
		if (isHistoricalRef(nodeData.content.inputRef, allNodes)) return true;
		for (const ref of nodeData.content.promptRefs) {
			if (isHistoricalRef(ref, allNodes)) return true;
		}
		for (const ref of nodeData.content.indirectPromptRefs) {
			if (isHistoricalRef(ref, allNodes)) return true;
		}
		return false;
	}

	// Get nodes that will be published
	let nodesToPublish = $derived.by(() => {
		return nodes.filter((node) => {
			if (node.data.external) return false;
			if (node.data.type === 'GENERATED') {
				if (referencesHistoricalVersions(node.data as GeneratedNodeData, nodes)) {
					return false;
				}
			}
			return true;
		});
	});

	// Group nodes by type
	let nodesByType = $derived.by(() => {
		const groups: Record<string, Node<StudioNodeData>[]> = {
			PROMPT: [],
			INPUT: [],
			GENERATED: []
		};
		
		for (const node of nodesToPublish) {
			if (node.data.type in groups) {
				groups[node.data.type].push(node);
			}
		}
		
		return groups;
	});

	// Get edges to publish
	let edgesToPublish = $derived.by(() => {
		const publishedIds = new Set(nodesToPublish.map((n) => n.id));
		return edges.filter((e) => publishedIds.has(e.source) && publishedIds.has(e.target));
	});

	// Auto-generate slug from name
	function generateSlug(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '');
	}

	function handleNameInput(e: Event) {
		const target = e.target as HTMLInputElement;
		name = target.value;
		if (!slug || slug === generateSlug(name.slice(0, -1))) {
			slug = generateSlug(name);
		}
	}

	function toggleCategory(type: string) {
		expandedCategories[type] = !expandedCategories[type];
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		errorMessage = '';
		successMessage = '';

		if (!name.trim()) {
			errorMessage = m.studio_error_name_required();
			return;
		}
		if (!slug.trim()) {
			errorMessage = m.studio_error_slug_required();
			return;
		}
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
			errorMessage = m.studio_error_slug_format();
			return;
		}
		if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/.test(version)) {
			errorMessage = m.studio_error_version_format();
			return;
		}
		if (nodesToPublish.length === 0) {
			errorMessage = m.studio_error_no_nodes();
			return;
		}

		isSubmitting = true;

		try {
			const metadata: PublishMetadata = {
				type: artifactType,
				name: name.trim(),
				slug: slug.trim(),
				description: description.trim(),
				visibility,
				version: version.trim(),
				tags: tagsInput.split(',').map((t) => t.trim()).filter((t) => t.length > 0),
				homepage: homepage.trim() || undefined
			};

			await onPublish(metadata, nodesToPublish, edgesToPublish);
			successMessage = m.studio_published_success();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : m.studio_publish_failed();
		} finally {
			isSubmitting = false;
		}
	}

	function getNodeDisplayName(node: Node<StudioNodeData>): string {
		return node.data.name || node.id.slice(0, 8);
	}

	function getCategoryLabel(type: string): string {
		switch (type) {
			case 'PROMPT': return m.studio_overview_prompts();
			case 'INPUT': return m.studio_overview_inputs();
			case 'GENERATED': return m.studio_overview_generated();
			default: return type;
		}
	}

	function getCategoryColor(type: string): string {
		switch (type) {
			case 'PROMPT': return 'bg-blue-100 text-blue-800';
			case 'INPUT': return 'bg-purple-100 text-purple-800';
			case 'GENERATED': return 'bg-green-100 text-green-800';
			default: return 'bg-gray-100 text-gray-800';
		}
	}
</script>

<div class="h-full overflow-y-auto">
	<form id="project-form" onsubmit={handleSubmit} class="p-4 space-y-4">
		<!-- Published Status Banner -->
		{#if !isDraft}
			<div class="rounded-lg bg-green-50 border border-green-200 p-3 flex items-start gap-3">
				<svg class="w-5 h-5 text-green-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
				</svg>
				<div>
					<p class="text-sm font-medium text-green-800">{m.studio_published_banner()}</p>
					<p class="text-xs text-green-600 mt-0.5">{m.studio_published_desc()}</p>
					<a
						href="/artifact/{projectId}"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center gap-1 text-xs text-green-700 hover:text-green-800 mt-2 font-medium"
					>
						{m.studio_view_artifact()}
						<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
						</svg>
					</a>
				</div>
			</div>
		{/if}

		<!-- Auth Required Banner -->
		{#if !isAuthenticated}
			<div class="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-3">
				<svg class="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<div>
					<p class="text-sm font-medium text-amber-800">{m.studio_login_required()}</p>
					<p class="text-xs text-amber-600 mt-0.5">{m.studio_login_required_desc()}</p>
				</div>
			</div>
		{/if}

		<!-- Basic Info -->
		<div class="space-y-3">
			<div>
				<label for="name" class="block text-xs font-medium text-gray-500 mb-1">
					{m.studio_form_name()} <span class="text-red-500">*</span>
				</label>
				<input
					id="name"
					type="text"
					value={name}
					oninput={handleNameInput}
					placeholder={m.studio_form_name_placeholder()}
					class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				/>
			</div>

			<div>
				<label for="slug" class="block text-xs font-medium text-gray-500 mb-1">
					{m.studio_form_slug()} <span class="text-red-500">*</span>
				</label>
				<input
					id="slug"
					type="text"
					bind:value={slug}
					placeholder={m.studio_form_slug_placeholder()}
					class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				/>
				<p class="mt-1 text-xs text-gray-400">{m.studio_form_slug_hint()}</p>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="type" class="block text-xs font-medium text-gray-500 mb-1">{m.studio_form_type()}</label>
					<select
						id="type"
						bind:value={artifactType}
						class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					>
						<option value="RECIPE">{m.studio_form_type_recipe()}</option>
						<option value="GAME">{m.studio_form_type_game()}</option>
						<option value="ASSET_PACK">{m.studio_form_type_asset_pack()}</option>
						<option value="PROMPT">{m.studio_form_type_prompt()}</option>
					</select>
				</div>

				<div>
					<label for="visibility" class="block text-xs font-medium text-gray-500 mb-1">{m.studio_form_visibility()}</label>
					<select
						id="visibility"
						bind:value={visibility}
						class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					>
						<option value="PUBLIC">{m.studio_form_visibility_public()}</option>
						<option value="UNLISTED">{m.studio_form_visibility_unlisted()}</option>
						<option value="PRIVATE">{m.studio_form_visibility_private()}</option>
					</select>
				</div>
			</div>

			<div>
				<label for="version" class="block text-xs font-medium text-gray-500 mb-1">
					{m.studio_form_version()} <span class="text-red-500">*</span>
				</label>
				<input
					id="version"
					type="text"
					bind:value={version}
					placeholder={m.studio_form_version_placeholder()}
					class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				/>
			</div>

			<div>
				<label for="description" class="block text-xs font-medium text-gray-500 mb-1">{m.studio_form_description()}</label>
				<textarea
					id="description"
					bind:value={description}
					placeholder={m.studio_form_description_placeholder()}
					rows="2"
					class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
				></textarea>
			</div>

			<div>
				<label for="tags" class="block text-xs font-medium text-gray-500 mb-1">{m.studio_form_tags()}</label>
				<input
					id="tags"
					type="text"
					bind:value={tagsInput}
					placeholder={m.studio_form_tags_placeholder()}
					class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
				/>
			</div>

			<div>
				<label for="homepage" class="block text-xs font-medium text-gray-500 mb-1">
					{m.studio_form_homepage()} <span class="text-gray-400">({m.studio_form_homepage_markdown()})</span>
				</label>
				<textarea
					id="homepage"
					bind:value={homepage}
					placeholder={m.studio_form_homepage_placeholder()}
					rows="4"
					class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono resize-y"
				></textarea>
			</div>
		</div>

		<!-- Nodes Preview -->
		<div class="border-t border-gray-100 pt-4">
			<h3 class="text-xs font-medium text-gray-500 mb-2">
				{m.studio_nodes_to_publish({ count: nodesToPublish.length })}
			</h3>
			
			<div class="space-y-2">
				{#each Object.entries(nodesByType) as [type, typeNodes]}
					{#if typeNodes.length > 0}
						<div class="border border-gray-200 rounded-lg overflow-hidden">
							<button
								type="button"
								class="w-full px-3 py-2 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
								onclick={() => toggleCategory(type)}
							>
								<div class="flex items-center gap-2">
									<span class="px-1.5 py-0.5 text-xs font-medium rounded {getCategoryColor(type)}">
										{getCategoryLabel(type)}
									</span>
									<span class="text-xs text-gray-500">{typeNodes.length}</span>
								</div>
								<svg
									class="w-4 h-4 text-gray-400 transition-transform {expandedCategories[type] ? 'rotate-180' : ''}"
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
								</svg>
							</button>
							
							{#if expandedCategories[type]}
								<div class="divide-y divide-gray-100">
									{#each typeNodes as node}
										<div class="px-3 py-1.5 flex items-center gap-2 text-xs">
											<span class="text-gray-400 font-mono">{node.id.slice(0, 6)}</span>
											<span class="text-gray-600 truncate">{getNodeDisplayName(node)}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				{/each}
			</div>

			{#if nodesToPublish.length === 0}
				<div class="text-center py-6 text-gray-400">
					<svg class="w-8 h-8 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
					</svg>
					<p class="text-xs">{m.studio_no_nodes_to_publish()}</p>
				</div>
			{/if}
		</div>

		<!-- Messages -->
		{#if errorMessage}
			<div class="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
				<svg class="w-4 h-4 text-red-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
				</svg>
				<p class="text-xs text-red-700">{errorMessage}</p>
			</div>
		{/if}

		{#if successMessage}
			<div class="rounded-lg bg-green-50 border border-green-200 p-3 flex items-start gap-2">
				<svg class="w-4 h-4 text-green-400 shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
					<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
				</svg>
				<p class="text-xs text-green-700">{successMessage}</p>
			</div>
		{/if}

		<!-- Publish Button -->
		<button
			type="submit"
			disabled={isSubmitting || nodesToPublish.length === 0 || !isAuthenticated}
			class="w-full py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
		>
			{#if isSubmitting}
				<svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				{m.studio_publishing()}
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
				</svg>
				{isDraft ? m.studio_publish() : m.studio_update()}
			{/if}
		</button>
	</form>
</div>
