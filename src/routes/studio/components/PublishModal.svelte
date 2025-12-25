<script lang="ts">
	import type { Node, Edge } from '@xyflow/svelte';
	import type { StudioNodeData, GeneratedNodeData } from '../utils/types';
	import type { NodeRef } from '../stores/version';
	import type { PublishMetadata } from '../utils/publish';

	interface Props {
		nodes: Node<StudioNodeData>[];
		edges: Edge[];
		onClose: () => void;
		onPublish: (metadata: PublishMetadata, nodesToPublish: Node<StudioNodeData>[], edges: Edge[]) => Promise<void>;
	}

	// Re-export PublishMetadata for convenience
	export type { PublishMetadata };

	let { nodes, edges, onClose, onPublish }: Props = $props();

	// Form state
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

	// Category expand state
	let expandedCategories = $state<Record<string, boolean>>({
		PROMPT: true,
		INPUT: true,
		GENERATED: true
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
		if (isHistoricalRef(nodeData.inputRef, allNodes)) return true;
		for (const ref of nodeData.promptRefs) {
			if (isHistoricalRef(ref, allNodes)) return true;
		}
		for (const ref of nodeData.indirectPromptRefs) {
			if (isHistoricalRef(ref, allNodes)) return true;
		}
		return false;
	}

	// Get nodes that will be published (excluding external and historical refs)
	let nodesToPublish = $derived.by(() => {
		return nodes.filter((node) => {
			// Skip external nodes
			if (node.data.external) return false;
			
			// Skip GENERATED nodes that reference historical versions
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
			groups[node.data.type].push(node);
		}
		
		return groups;
	});

	// Get edges that connect published nodes
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

	function handleNameChange(e: Event) {
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

		// Validation
		if (!name.trim()) {
			errorMessage = 'Name is required';
			return;
		}
		if (!slug.trim()) {
			errorMessage = 'Slug is required';
			return;
		}
		if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
			errorMessage = 'Slug must be lowercase letters and numbers, separated by hyphens';
			return;
		}
		if (!/^\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/.test(version)) {
			errorMessage = 'Version must be in semver format (e.g., 1.0.0)';
			return;
		}
		if (nodesToPublish.length === 0) {
			errorMessage = 'No nodes to publish';
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
				tags: tagsInput
					.split(',')
					.map((t) => t.trim())
					.filter((t) => t.length > 0),
				homepage: homepage.trim() || undefined
			};

			await onPublish(metadata, nodesToPublish, edgesToPublish);
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Failed to publish';
		} finally {
			isSubmitting = false;
		}
	}

	function getNodeDisplayName(node: Node<StudioNodeData>): string {
		return node.data.name || node.id.slice(0, 8);
	}

	function getCategoryLabel(type: string): string {
		switch (type) {
			case 'PROMPT':
				return 'Prompts';
			case 'INPUT':
				return 'Inputs';
			case 'GENERATED':
				return 'Generated';
			default:
				return type;
		}
	}

	function getCategoryColor(type: string): string {
		switch (type) {
			case 'PROMPT':
				return 'bg-blue-100 text-blue-800';
			case 'INPUT':
				return 'bg-green-100 text-green-800';
			case 'GENERATED':
				return 'bg-purple-100 text-purple-800';
			default:
				return 'bg-gray-100 text-gray-800';
		}
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
	onclick={(e) => {
		if (e.target === e.currentTarget) onClose();
	}}
>
	<div class="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
		<!-- Header -->
		<div class="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
			<h2 class="text-xl font-semibold text-gray-900">Publish Artifact</h2>
			<button
				type="button"
				class="text-gray-400 hover:text-gray-500 transition-colors"
				onclick={onClose}
				aria-label="Close dialog"
			>
				<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto p-6">
			<form id="publish-form" onsubmit={handleSubmit} class="space-y-6">
				<!-- Basic Info -->
				<div class="space-y-4">
					<div>
						<label for="name" class="block text-sm font-medium text-gray-700 mb-1">
							Name <span class="text-red-500">*</span>
						</label>
						<input
							id="name"
							type="text"
							bind:value={name}
							oninput={handleNameChange}
							placeholder="My Awesome Artifact"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent"
						/>
					</div>

					<div>
						<label for="slug" class="block text-sm font-medium text-gray-700 mb-1">
							Slug <span class="text-red-500">*</span>
						</label>
						<input
							id="slug"
							type="text"
							bind:value={slug}
							placeholder="my-awesome-artifact"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent"
						/>
						<p class="mt-1 text-xs text-gray-500">URL-friendly identifier (lowercase, numbers, hyphens only)</p>
					</div>

					<div class="grid grid-cols-2 gap-4">
						<div>
							<label for="type" class="block text-sm font-medium text-gray-700 mb-1">Type</label>
							<select
								id="type"
								bind:value={artifactType}
								class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent"
							>
								<option value="RECIPE">Recipe</option>
								<option value="GAME">Game</option>
								<option value="ASSET_PACK">Asset Pack</option>
								<option value="PROMPT">Prompt</option>
							</select>
						</div>

						<div>
							<label for="visibility" class="block text-sm font-medium text-gray-700 mb-1">Visibility</label>
							<select
								id="visibility"
								bind:value={visibility}
								class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent"
							>
								<option value="PUBLIC">Public</option>
								<option value="UNLISTED">Unlisted</option>
								<option value="PRIVATE">Private</option>
							</select>
						</div>
					</div>

					<div>
						<label for="version" class="block text-sm font-medium text-gray-700 mb-1">
							Version <span class="text-red-500">*</span>
						</label>
						<input
							id="version"
							type="text"
							bind:value={version}
							placeholder="1.0.0"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent"
						/>
						<p class="mt-1 text-xs text-gray-500">Semantic version (e.g., 1.0.0, 2.1.0-beta)</p>
					</div>

					<div>
						<label for="description" class="block text-sm font-medium text-gray-700 mb-1">Description</label>
						<textarea
							id="description"
							bind:value={description}
							placeholder="Describe your artifact..."
							rows="3"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent resize-none"
						></textarea>
					</div>

					<div>
						<label for="tags" class="block text-sm font-medium text-gray-700 mb-1">Tags</label>
						<input
							id="tags"
							type="text"
							bind:value={tagsInput}
							placeholder="tag1, tag2, tag3"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent"
						/>
						<p class="mt-1 text-xs text-gray-500">Comma-separated list of tags</p>
					</div>

					<div>
						<label for="homepage" class="block text-sm font-medium text-gray-700 mb-1">
							Homepage
							<span class="text-gray-400 font-normal">(Markdown)</span>
						</label>
						<textarea
							id="homepage"
							bind:value={homepage}
							placeholder="# Welcome to My Artifact&#10;&#10;Write your artifact's homepage content here using Markdown..."
							rows="8"
							class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0969da] focus:border-transparent font-mono text-sm resize-y"
						></textarea>
						<p class="mt-1 text-xs text-gray-500">
							Optional homepage content. Supports Markdown formatting. Will be rendered as HTML on the artifact page.
						</p>
					</div>
				</div>

				<!-- Nodes Preview -->
				<div class="border-t border-gray-200 pt-6">
					<h3 class="text-sm font-medium text-gray-700 mb-3">
						Nodes to Publish ({nodesToPublish.length})
					</h3>
					
					<div class="space-y-2">
						{#each Object.entries(nodesByType) as [type, typeNodes]}
							{#if typeNodes.length > 0}
								<div class="border border-gray-200 rounded-lg overflow-hidden">
									<!-- Category Header -->
									<button
										type="button"
										class="w-full px-4 py-2 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
										onclick={() => toggleCategory(type)}
									>
										<div class="flex items-center gap-2">
											<span class={`px-2 py-0.5 text-xs font-medium rounded ${getCategoryColor(type)}`}>
												{getCategoryLabel(type)}
											</span>
											<span class="text-sm text-gray-600">{typeNodes.length} node{typeNodes.length !== 1 ? 's' : ''}</span>
										</div>
										<svg
											class="w-4 h-4 text-gray-500 transition-transform {expandedCategories[type] ? 'rotate-180' : ''}"
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
										</svg>
									</button>
									
									<!-- Node List -->
									{#if expandedCategories[type]}
										<div class="divide-y divide-gray-100">
											{#each typeNodes as node}
												<div class="px-4 py-2 flex items-center gap-2 text-sm">
													<span class="text-gray-400 font-mono text-xs">{node.id.slice(0, 8)}</span>
													<span class="text-gray-700">{getNodeDisplayName(node)}</span>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					</div>

					{#if nodesToPublish.length === 0}
						<div class="text-center py-8 text-gray-500">
							<svg class="w-12 h-12 mx-auto mb-2 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
							</svg>
							<p>No nodes available to publish</p>
							<p class="text-xs mt-1">External nodes and nodes referencing historical versions are excluded</p>
						</div>
					{/if}
				</div>

				<!-- Error Message -->
				{#if errorMessage}
					<div class="rounded-lg bg-red-50 p-4">
						<div class="flex items-start gap-3">
							<svg class="h-5 w-5 text-red-400 shrink-0" viewBox="0 0 20 20" fill="currentColor">
								<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
							</svg>
							<p class="text-sm text-red-800">{errorMessage}</p>
						</div>
					</div>
				{/if}
			</form>
		</div>

		<!-- Footer -->
		<div class="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
			<button
				type="button"
				class="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
				onclick={onClose}
				disabled={isSubmitting}
			>
				Cancel
			</button>
			<button
				type="submit"
				form="publish-form"
				disabled={isSubmitting || nodesToPublish.length === 0}
				class="px-4 py-2 text-sm font-medium text-white bg-[#2da44e] hover:bg-[#2c974b] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
			>
				{#if isSubmitting}
					<svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					Publishing...
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
					</svg>
					Publish
				{/if}
			</button>
		</div>
	</div>
</div>
