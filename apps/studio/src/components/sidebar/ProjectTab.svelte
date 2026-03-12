<script lang="ts">
	/**
	 * ProjectTab - Project settings and publish functionality
	 * 
	 * All form fields are persisted to IndexedDB in real-time so changes
	 * survive page refresh. Authentication is only required for publishing.
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { FlowNodeData } from '$lib/types/flow';
	import type { GeneratedNodeData } from '$lib/types';
	import type { StudioNodeData } from '$lib/types';
	import type { NodeRef } from '$lib/version';
	import { type PublishMetadata } from '$lib/io';
	import type { DraftSyncState } from '$lib/sync';
	import { formatRelativeSyncTime } from '$lib/sync';
	import { nodeStore } from '$lib/persistence/node-store.svelte';
	import { getProject, saveProject } from '$lib/persistence/db';
	import { reportSaveState } from '$lib/persistence/save-tracker.svelte';
	import { Toggle } from '@pubwiki/ui/components';
	import * as m from '$lib/paraglide/messages';
	import { PUBLIC_HUB_URL } from '$env/static/public';
	import EntrypointSection, { type SelectedSave } from './EntrypointSection.svelte';
	import { createSaveCheckpoint, getArtifactContext } from '$lib/gamesave';
	import { getNodeRDFStore } from '$lib/rdf';

	const hubUrl = PUBLIC_HUB_URL || 'http://localhost:5173';

	interface Props {
		nodes: Node<FlowNodeData>[];
		edges: Edge[];
		projectId: string;
		projectName: string;
		isDraft: boolean;
		isAuthenticated: boolean;
		/** Last cloud commit hash for version lineage tracking */
		lastCloudCommit?: string;
		onPublish: (metadata: PublishMetadata, nodes: Node<FlowNodeData>[], edges: Edge[], buildCacheKey?: string) => Promise<void>;
		/** Called when user edits the project name, for real-time sync with sidebar header */
		onNameChange?: (name: string) => void;
		// Cloud sync
		syncState?: DraftSyncState;
		onSync?: () => void;
		onEnableSync?: () => void;
		// Build cache
		selectedEntrypoint?: string | null;
		onEntrypointChange?: (sandboxNodeId: string | null) => void;
	}

	let { nodes, edges, projectId, projectName, isDraft, isAuthenticated, lastCloudCommit, onPublish, onNameChange, syncState, onSync, onEnableSync, selectedEntrypoint = null, onEntrypointChange }: Props = $props();

	// Cloud sync toggle handler
	function handleSyncToggle(checked: boolean) {
		if (checked) {
			onEnableSync?.();
		}
		// Disabling sync is not supported via this toggle currently
	}

	let syncEnabled = $derived(syncState?.enabled ?? false);
	let isSyncing = $derived(syncState?.status === 'syncing');
	let hasAnyChanges = $derived((syncState?.hasUnsyncedChanges ?? false) || (syncState?.hasVfsChanges ?? false));

	// Form state - loaded from IndexedDB, auto-persisted on change
	let name = $state('');
	let description = $state('');
	let homepage = $state('');
	let isUnlisted = $state(false);
	let isPrivate = $state(false);
	let version = $state('1.0.0');
	let tagsInput = $state('');

	// Build cache key resolved by EntrypointSection (avoids duplicate computation)
	let resolvedBuildCacheKey = $state<string | null>(null);
	// Selected save from EntrypointSection
	let selectedSave = $state<SelectedSave | null>(null);
	// Publishing requires a valid build when an entrypoint is selected
	let needsBuild = $derived(selectedEntrypoint != null && resolvedBuildCacheKey == null);	let isSubmitting = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let loaded = $state(false);

	// Load persisted metadata from IndexedDB on mount
	$effect(() => {
		if (!loaded && projectId) {
			// Use projectId as dependency, re-load if project changes
			loadProjectMetadata();
		}
	});

	async function loadProjectMetadata() {
		const project = await getProject(projectId);
		if (project) {
			name = project.name || '';
			description = project.description || '';
			homepage = project.homepage || '';
			tagsInput = project.tags || '';
			version = project.version || '1.0.0';
			isPrivate = project.isPrivate ?? false;
			isUnlisted = project.isUnlisted ?? false;
		} else {
			// Fallback to prop
			name = projectName;
		}
		loaded = true;
		lastPersisted = snapshotCurrent();
	}

	// Auto-persist metadata changes with debounce
	let persistTimer: ReturnType<typeof setTimeout> | undefined;
	
	// Snapshot of the last persisted values to detect real user changes
	let lastPersisted = $state<{
		name: string; description: string; homepage: string;
		tagsInput: string; version: string; isPrivate: boolean; isUnlisted: boolean;
	} | null>(null);

	function schedulePersist() {
		reportSaveState('metadata', 'dirty');
		clearTimeout(persistTimer);
		persistTimer = setTimeout(() => persistMetadata(), 300);
	}

	async function persistMetadata() {
		reportSaveState('metadata', 'saving');
		const project = await getProject(projectId);
		if (!project) return;
		await saveProject({
			...project,
			name: name.trim() || project.name,
			description,
			homepage,
			tags: tagsInput,
			version,
			isPrivate,
			isUnlisted,
			updatedAt: Date.now()
		});
		lastPersisted = { name, description, homepage, tagsInput, version, isPrivate, isUnlisted };
		reportSaveState('metadata', 'idle');
	}
	
	function snapshotCurrent() {
		return { name, description, homepage, tagsInput, version, isPrivate, isUnlisted };
	}

	// Watch all form fields and auto-persist (skip initial load)
	$effect(() => {
		// Access all reactive fields to create dependencies
		const current = snapshotCurrent();
		if (!loaded || !lastPersisted) return;
		// Only persist when values actually differ from last persisted state
		const changed = (Object.keys(current) as (keyof typeof current)[])
			.some(k => current[k] !== lastPersisted![k]);
		if (changed) {
			schedulePersist();
		}
	});

	// Check if a NodeRef references a historical version
	function isHistoricalRef(ref: NodeRef, getNodeData: (id: string) => StudioNodeData | undefined): boolean {
		const targetNodeData = getNodeData(ref.id);
		if (!targetNodeData) return true;
		return targetNodeData.commit !== ref.commit;
	}

	// Check if a generated node references any historical versions
	function referencesHistoricalVersions(
		nodeData: GeneratedNodeData,
		getNodeData: (id: string) => StudioNodeData | undefined
	): boolean {
		if (isHistoricalRef(nodeData.content.inputRef, getNodeData)) return true;
		for (const ref of nodeData.content.promptRefs) {
			if (isHistoricalRef(ref, getNodeData)) return true;
		}
		for (const ref of nodeData.content.indirectPromptRefs) {
			if (isHistoricalRef(ref, getNodeData)) return true;
		}
		return false;
	}

	// Get nodes that will be published
	// In the new architecture, all nodes are local and can be published
	let nodesToPublish = $derived.by(() => {
		const getNodeData = (id: string) => nodeStore.get(id);
		return nodes.filter((node) => {
			const nodeData = getNodeData(node.id);
			if (!nodeData) return false;
			if (nodeData.type === 'GENERATED') {
				if (referencesHistoricalVersions(nodeData as GeneratedNodeData, getNodeData)) {
					return false;
				}
			}
			return true;
		});
	});


	// Get edges to publish
	let edgesToPublish = $derived.by(() => {
		const publishedIds = new Set(nodesToPublish.map((n) => n.id));
		return edges.filter((e) => publishedIds.has(e.source) && publishedIds.has(e.target));
	});

	// Generate a random slug with name prefix and random suffix
	function generateRandomSlug(name: string): string {
		const prefix = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 30);
		const randomSuffix = crypto.randomUUID().slice(0, 8);
		return prefix ? `${prefix}-${randomSuffix}` : randomSuffix;
	}

	function handleNameInput(e: Event) {
		const target = e.target as HTMLInputElement;
		name = target.value;
		onNameChange?.(name);
	}

	async function handleSubmit(e: Event) {
		e.preventDefault();
		errorMessage = '';
		successMessage = '';

		if (!name.trim()) {
			errorMessage = m.studio_error_name_required();
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
			// Resolve save commit for entrypoint (upload local checkpoint if needed)
			let resolvedEntrypoint: PublishMetadata['entrypoint'];
			if (selectedEntrypoint && selectedSave) {
				let saveCommit: string;
				if (selectedSave.source === 'cloud' && selectedSave.saveCommit) {
					saveCommit = selectedSave.saveCommit;
				} else if (selectedSave.source === 'local' && selectedSave.checkpointId) {
					// Upload local checkpoint as cloud save before publishing
					const ctx = await getArtifactContext(projectId);
					if (!ctx.isPublished || !ctx.artifactId || !ctx.artifactCommit) {
						throw new Error('Cannot upload save: artifact not yet published. Please publish first without an entrypoint, then update with one.');
					}
					const store = await getNodeRDFStore(selectedSave.stateNodeId);
					await store.loadCheckpoint(selectedSave.checkpointId);
					const result = await createSaveCheckpoint(store, {
						stateNodeId: selectedSave.stateNodeId,
						artifactId: ctx.artifactId,
						artifactCommit: ctx.artifactCommit,
						title: selectedSave.title,
					});
					if (!result.success || !result.save) {
						throw new Error(result.error || 'Failed to upload save checkpoint');
					}
					saveCommit = result.save.commit;
				} else {
					throw new Error('Invalid save selection');
				}
				resolvedEntrypoint = { sandboxNodeId: selectedEntrypoint, saveCommit };
			}

			// Always use existing projectId as artifactId
			// Draft projects already have a UUID as their projectId
			const metadata: PublishMetadata = {
				artifactId: projectId,
				name: name.trim(),
				slug: generateRandomSlug(name.trim()),
				description: description.trim(),
				isListed: !isUnlisted,
				isPrivate,
				version: version.trim(),
				tags: tagsInput.split(',').map((t) => t.trim()).filter((t) => t.length > 0),
				homepage: homepage.trim() || undefined,
				// Track version lineage for updates
				parentCommit: lastCloudCommit ?? null,
				entrypoint: resolvedEntrypoint,
			};

			// Use the buildCacheKey already resolved by EntrypointSection
			// (avoids duplicating the entire contentHash → detectProject → computeBuildCacheKey pipeline)
			await onPublish(metadata, nodesToPublish, edgesToPublish, resolvedBuildCacheKey ?? undefined);
			successMessage = m.studio_published_success();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : m.studio_publish_failed();
		} finally {
			isSubmitting = false;
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
						href="{hubUrl}/artifact/{projectId}"
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

		<!-- Cloud Sync Section -->
		{#if isAuthenticated}
			<div class="space-y-2 rounded-lg border border-gray-200 p-3">
				<Toggle
					checked={syncEnabled}
					label={m.sync_enable_cloud()}
					description={syncEnabled ? undefined : m.sync_not_enabled()}
					size="sm"
					disabled={syncEnabled}
					onchange={handleSyncToggle}
				/>
				{#if syncEnabled}
					<div class="border-t border-gray-100 pt-2 flex items-center justify-between">
						<div class="text-xs text-gray-500">
							{#if syncState?.lastSyncedAt}
								{m.sync_last_synced({ time: formatRelativeSyncTime(syncState.lastSyncedAt) })}
							{:else}
								{m.sync_not_enabled()}
							{/if}
						</div>
						<button
							type="button"
							disabled={isSyncing || (!hasAnyChanges && syncState?.status !== 'error')}
							onclick={(e) => { e.preventDefault(); onSync?.(); }}
							class="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
						>
							{#if isSyncing}
								<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
									<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
									<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
								</svg>
							{/if}
							{m.sync_now()}
						</button>
					</div>
				{/if}
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

			<div class="space-y-2 rounded-lg border border-gray-200 p-3">
				<Toggle
					bind:checked={isPrivate}
					label={m.studio_form_visibility_private()}
					description={m.studio_form_visibility_private_description()}
					size="sm"
				/>
				<div class="border-t border-gray-100"></div>
				<Toggle
					bind:checked={isUnlisted}
					label={m.studio_form_visibility_unlisted()}
					description={m.studio_form_visibility_unlisted_description()}
					size="sm"
				/>
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

		<!-- Auth Required Hint + Publish Button -->
		{#if !isAuthenticated}
			<div class="flex items-center gap-2 px-1 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg">
				<svg class="w-3.5 h-3.5 text-amber-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
				</svg>
				<span>{m.studio_login_required()}</span>
			</div>
		{/if}

		<!-- Entrypoint Selection -->
		{#if onEntrypointChange}
			<EntrypointSection
				{nodes}
				{edges}
				{projectId}
				{selectedEntrypoint}
				{onEntrypointChange}
				onBuildCacheKeyChange={(key) => { resolvedBuildCacheKey = key; }}
			/>
		{/if}

		<!-- Build required hint -->
		{#if needsBuild}
			<p class="text-xs text-amber-600">{m.studio_publish_build_required()}</p>
		{/if}

		<!-- Publish Button -->
		<button
			type="submit"
			disabled={isSubmitting || nodesToPublish.length === 0 || !isAuthenticated || needsBuild}
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
