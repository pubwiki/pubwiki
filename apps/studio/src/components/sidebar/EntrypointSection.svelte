<script lang="ts">
	/**
	 * EntrypointSection - Entrypoint selection, save selector, and build status UI
	 *
	 * Displays a dropdown of sandbox nodes in the graph, resolves the
	 * connected VFS and STATE nodes, shows a save selector, and build status / actions.
	 *
	 * Build status is derived from:
	 *   - Local transient state: building / error (component-scoped $state)
	 *   - OPFS cache: checked on mount and after builds.
	 *   - Stale detection: listens to VFS file events directly.
	 *     After a successful OPFS check (or build), we clear the stale
	 *     flag. Any subsequent file event sets it back to true.
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { FlowNodeData } from '$lib/types/flow';
	import type { VFSNodeData } from '$lib/types';
	import type { UnifiedSave, SyncStatus } from '$lib/gamesave';
	import { nodeStore } from '$lib/persistence/node-store.svelte';
	import { Dropdown } from '@pubwiki/ui/components';
	import { HandleId } from '$lib/graph';
	import { runBuild } from '$lib/io/build-runner';
	import { getNodeVfs } from '$lib/vfs';
	import { getOpfsBuildCacheStorage, detectProject } from '@pubwiki/bundler';
	import { computeBuildCacheKey } from '@pubwiki/api';
	import { computeVfsFileHashes, computeVfsContentHash } from '$lib/io/vfs-content-hash';
	import { getNodeRDFStore } from '$lib/rdf';
	import { listUnifiedSaves } from '$lib/gamesave';

	export type BuildStatus =
		| { state: 'none' }
		| { state: 'checking' }
		| { state: 'building'; message?: string }
		| { state: 'ready' }
		| { state: 'stale' }
		| { state: 'error'; message: string };

	/** Represents a selected save for publish */
	export interface SelectedSave {
		/** Checkpoint ID (= saveId = nodeId) */
		checkpointId: string;
		/** Cloud commit hash if synced */
		cloudCommit?: string;
		/** STATE node ID this save belongs to */
		stateNodeId: string;
		/** Display title */
		title: string;
	}

	interface Props {
		nodes: Node<FlowNodeData>[];
		edges: Edge[];
		projectId: string;
		/** Selected sandbox node ID — persisted by parent */
		selectedEntrypoint: string | null;
		onEntrypointChange: (sandboxNodeId: string | null) => void;
		/** Called when the resolved buildCacheKey changes (null = no valid cache). */
		onBuildCacheKeyChange?: (key: string | null) => void;
		/** Called when the selected save changes */
		onSaveChange?: (save: SelectedSave | null) => void;
		/** Called when graph completeness changes (true = required connections are missing) */
		onGraphIncompleteChange?: (incomplete: boolean) => void;
	}

	let { nodes, edges, projectId, selectedEntrypoint, onEntrypointChange, onBuildCacheKeyChange, onSaveChange, onGraphIncompleteChange }: Props = $props();

	// Dropdown item type: null represents "No entrypoint"
	interface EntrypointItem {
		id: string | null;
		label: string;
	}

	// Available sandbox nodes in the graph, with a "None" option prepended
	let dropdownItems: EntrypointItem[] = $derived.by(() => {
		const sandboxItems = nodes
			.filter(n => {
				const data = nodeStore.get(n.id);
				return data?.type === 'SANDBOX';
			})
			.map(n => ({
				id: n.id,
				label: String(n.data?.label ?? `Sandbox (${n.id.slice(0, 8)})`)
			}));
		return [{ id: null, label: 'No entrypoint' }, ...sandboxItems];
	});

	// Currently selected dropdown item
	let selectedItem: EntrypointItem = $derived(
		dropdownItems.find(item => item.id === selectedEntrypoint) ?? dropdownItems[0]
	);

	// Resolve the VFS node connected to the selected sandbox node
	let connectedVfsNodeId = $derived.by(() => {
		if (!selectedEntrypoint) return null;
		for (const edge of edges) {
			if (edge.target === selectedEntrypoint && edge.targetHandle === 'vfs-input') {
				const sourceData = nodeStore.get(edge.source);
				if (sourceData?.type === 'VFS') return edge.source;
			}
		}
		return null;
	});

	// Resolve the STATE node connected to the selected sandbox:
	// SANDBOX ←[SERVICE_INPUT]── LOADER ←[LOADER_STATE]── STATE
	let connectedStateNodeId = $derived.by(() => {
		if (!selectedEntrypoint) return null;
		// Find LOADER node(s) connected to sandbox via service-input
		for (const edge of edges) {
			if (edge.target === selectedEntrypoint && edge.targetHandle === HandleId.SERVICE_INPUT) {
				const loaderData = nodeStore.get(edge.source);
				if (loaderData?.type !== 'LOADER') continue;
				// Find STATE node connected to this loader via loader-state
				for (const e2 of edges) {
					if (e2.target === edge.source && e2.targetHandle === HandleId.LOADER_STATE) {
						const stateData = nodeStore.get(e2.source);
						if (stateData?.type === 'STATE') return e2.source;
					}
				}
			}
		}
		return null;
	});

	// Graph completeness: when an entrypoint is selected, required connections must exist
	let graphIncomplete = $derived(
		selectedEntrypoint != null && (connectedVfsNodeId == null || connectedStateNodeId == null)
	);

	$effect(() => {
		onGraphIncompleteChange?.(graphIncomplete);
	});

	// ---- Save selector state ----
	interface SaveDropdownItem {
		id: string;
		label: string;
		syncStatus?: SyncStatus;
		checkpointId?: string;
		cloudCommit?: string;
	}

	let unifiedSaves = $state<UnifiedSave[]>([]);
	let loadingSaves = $state(false);
	let selectedSaveId = $state<string | null>(null);
	let showCreateForm = $state(false);
	let newSaveTitle = $state('');
	let newSaveDescription = $state('');
	let isCreatingSave = $state(false);

	const CREATE_NEW_ID = '__create_new__';
	const NONE_ID = '__none__';

	// Build the save dropdown items: "No save" + saves + "Create New"
	let saveDropdownItems = $derived.by(() => {
		const items: SaveDropdownItem[] = [
			{ id: NONE_ID, label: 'No save selected' },
		];
		for (const s of unifiedSaves) {
			items.push({
				id: s.id,
				label: s.title,
				syncStatus: s.syncStatus,
				checkpointId: s.id,
				cloudCommit: s.cloudCommit,
			});
		}
		items.push({
			id: CREATE_NEW_ID,
			label: '+ Create New Save',
		});
		return items;
	});

	let selectedSaveItem = $derived(
		saveDropdownItems.find(item => item.id === selectedSaveId) ?? saveDropdownItems[0]
	);

	// Load saves when STATE node changes
	$effect(() => {
		const stateId = connectedStateNodeId;
		if (!stateId) {
			unifiedSaves = [];
			selectedSaveId = null;
			showCreateForm = false;
			onSaveChange?.(null);
			return;
		}
		let cancelled = false;
		loadingSaves = true;
		loadSaveItems(stateId).then(items => {
			if (cancelled) return;
			unifiedSaves = items;
			loadingSaves = false;
			// Auto-select the most recent save if available
			if (items.length > 0 && !selectedSaveId) {
				selectedSaveId = items[0].id;
			}
		}).catch(() => {
			if (cancelled) return;
			unifiedSaves = [];
			loadingSaves = false;
		});
		return () => { cancelled = true; };
	});

	// Notify parent when selected save changes
	$effect(() => {
		const stateId = connectedStateNodeId;
		if (!stateId || !selectedSaveId || selectedSaveId === NONE_ID || selectedSaveId === CREATE_NEW_ID) {
			onSaveChange?.(null);
			return;
		}
		const item = saveDropdownItems.find(s => s.id === selectedSaveId);
		if (!item || !item.checkpointId) {
			onSaveChange?.(null);
			return;
		}
		onSaveChange?.({
			checkpointId: item.checkpointId,
			cloudCommit: item.cloudCommit,
			stateNodeId: stateId,
			title: item.label,
		});
	});

	async function loadSaveItems(stateNodeId: string): Promise<UnifiedSave[]> {
		const store = await getNodeRDFStore(stateNodeId);
		return listUnifiedSaves(store, stateNodeId);
	}

	function handleSaveSelect(item: SaveDropdownItem) {
		if (item.id === CREATE_NEW_ID) {
			showCreateForm = true;
			return;
		}
		showCreateForm = false;
		selectedSaveId = item.id;
	}

	async function handleCreateSave() {
		const stateId = connectedStateNodeId;
		if (!stateId || !newSaveTitle.trim()) return;

		isCreatingSave = true;
		try {
			const store = await getNodeRDFStore(stateId);
			await store.checkpoint({ title: newSaveTitle.trim(), description: newSaveDescription.trim() || undefined });
			// Reload saves and select the newly created one
			const items = await loadSaveItems(stateId);
			unifiedSaves = items;
			// The newest checkpoint should be first
			if (items.length > 0) {
				selectedSaveId = items[0].id;
			}
			newSaveTitle = '';
			newSaveDescription = '';
			showCreateForm = false;
		} catch (err) {
			console.error('Failed to create save:', err);
		} finally {
			isCreatingSave = false;
		}
	}

	function handleCancelCreate() {
		showCreateForm = false;
		newSaveTitle = '';
		newSaveDescription = '';
	}

	// ---- Stale detection via VFS events ----
	// When we have a valid build cache, only dependency file changes mark the build as stale.
	let buildStale = $state(false);
	/** Known dependency file paths from the last cache check/build — used for smart stale detection. */
	let buildDeps = $state<Set<string>>(new Set());
	$effect(() => {
		const vfsId = connectedVfsNodeId;
		if (!vfsId) return;
		const data = nodeStore.get(vfsId) as VFSNodeData | undefined;
		if (!data || data.type !== 'VFS') return;
		let cancelled = false;
		const unsubs: Array<() => void> = [];
		getNodeVfs(data.content.projectId, vfsId).then(vfs => {
			if (cancelled) return;
			const markStaleIfDep = (event: { path: string }) => {
				// If no deps known yet (first load, legacy), mark stale on any change
				if (buildDeps.size === 0 || buildDeps.has(event.path)) {
					buildStale = true;
				}
			};
			unsubs.push(
				vfs.events.on('file:created', markStaleIfDep),
				vfs.events.on('file:updated', markStaleIfDep),
				vfs.events.on('file:deleted', markStaleIfDep),
			);
		});
		return () => { cancelled = true; unsubs.forEach(u => u()); };
	});

	// ---- Transient build state (component-local) ----
	let building = $state(false);
	let buildingMessage = $state<string | undefined>(undefined);
	let buildError = $state<string | null>(null);

	// ---- OPFS cache status ----
	let checkingCache = $state(false);
	let opfsCacheValid = $state(false);
	// The buildCacheKey from the last successful check (for publish).
	let lastBuildCacheKey = $state<string | null>(null);

	// Notify parent when the resolved buildCacheKey changes
	$effect(() => {
		onBuildCacheKeyChange?.(lastBuildCacheKey);
	});

	const buildCacheStorage = getOpfsBuildCacheStorage();

	/**
	 * Check whether OPFS has a valid build for the current VFS content.
	 * Uses smart resolve() — may hit even when non-dep files changed.
	 * Sets opfsCacheValid, buildDeps, and clears stale flag on success.
	 */
	async function checkOpfsCache(vfsId: string): Promise<void> {
		try {
			const data = nodeStore.get(vfsId) as VFSNodeData | undefined;
			if (!data || data.type !== 'VFS') { opfsCacheValid = false; return; }

			const nodeVfsInstance = await getNodeVfs(data.content.projectId, vfsId);
			const config = await detectProject('/tsconfig.json', nodeVfsInstance);
			if (!config?.isBuildable || config.entryFiles.length === 0) {
				opfsCacheValid = false;
				return;
			}

			const [contentHash, fileHashes] = await Promise.all([
				computeVfsContentHash(data.content.projectId, vfsId),
				computeVfsFileHashes(data.content.projectId, vfsId),
			]);
			const key = await computeBuildCacheKey({
				filesHash: contentHash,
				entryFiles: config.entryFiles,
			});

			// Smart resolve — dependency-aware cache lookup
			const entry = await buildCacheStorage.resolve(key, fileHashes);
			if (entry) {
				opfsCacheValid = true;
				lastBuildCacheKey = key;
				buildStale = false;
				// Update known deps for smart stale detection
				if (entry.metadata.dependencies?.length) {
					buildDeps = new Set(entry.metadata.dependencies);
				}
			} else {
				opfsCacheValid = false;
				lastBuildCacheKey = null;
			}
		} catch {
			opfsCacheValid = false;
		}
	}

	// Check OPFS cache on mount / when VFS node changes
	$effect(() => {
		const vfsId = connectedVfsNodeId;
		if (!vfsId) {
			opfsCacheValid = false;
			lastBuildCacheKey = null;
			buildStale = false;
			checkingCache = false;
			return;
		}
		let cancelled = false;
		checkingCache = true;
		checkOpfsCache(vfsId).then(() => {
			if (cancelled) return;
			checkingCache = false;
		});
		return () => { cancelled = true; };
	});

	// Build status derivation
	let buildStatus: BuildStatus = $derived.by(() => {
		if (building) return { state: 'building' as const, message: buildingMessage };
		if (buildError) return { state: 'error' as const, message: buildError };
		if (checkingCache) return { state: 'checking' as const };
		if (opfsCacheValid) {
			if (buildStale) return { state: 'stale' as const };
			return { state: 'ready' as const };
		}
		return { state: 'none' as const };
	});

	async function handleBuild() {
		if (!connectedVfsNodeId) return;
		building = true;
		buildingMessage = undefined;
		buildError = null;
		try {
			const result = await runBuild({
				vfsNodeId: connectedVfsNodeId,
				projectId,
				onProgress: (msg) => { buildingMessage = msg; },
			});
			if (!result.success) {
				buildError = result.error ?? 'Build failed';
			} else {
				// Refresh OPFS status after successful build
				lastBuildCacheKey = result.buildCacheKey;
				opfsCacheValid = true;
				buildStale = false;
			}
		} catch (err) {
			buildError = err instanceof Error ? err.message : 'Build failed';
		} finally {
			building = false;
			buildingMessage = undefined;
		}
	}
</script>

<div class="space-y-2 rounded-lg border border-gray-200 p-3">
	<span class="block text-xs font-medium text-gray-500">Entrypoint</span>

	<!-- Sandbox node dropdown -->
	<Dropdown
		items={dropdownItems}
		value={selectedItem}
		placeholder="No entrypoint"
		size="sm"
		getLabel={(item) => item.label}
		getKey={(item) => item.id ?? '__none__'}
		onchange={(item) => onEntrypointChange(item.id)}
	/>

	<!-- Build status & actions -->
	{#if selectedEntrypoint && connectedVfsNodeId}
		<div class="flex items-center gap-2 text-xs">
			{#if buildStatus.state === 'ready'}
				<span class="text-green-600 flex items-center gap-1">
					<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
					</svg>
					Build ready
				</span>
			{:else if buildStatus.state === 'stale'}
				<span class="text-amber-600 flex items-center gap-1">
					<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
						<path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
					</svg>
					Build stale
				</span>
				<button type="button" onclick={handleBuild}
					class="ml-auto px-2 py-0.5 text-xs text-white bg-amber-500 hover:bg-amber-600 rounded">
					Rebuild
				</button>
			{:else if buildStatus.state === 'building'}
				<span class="text-blue-600 flex items-center gap-1">
					<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Building...
				</span>
				{#if buildStatus.message}
					<p class="w-full text-[10px] text-blue-500 truncate" title={buildStatus.message}>{buildStatus.message}</p>
				{/if}
			{:else if buildStatus.state === 'error'}
				<span class="text-red-600 flex items-center gap-1 truncate" title={buildStatus.message}>
					Build failed
				</span>
				<button type="button" onclick={handleBuild}
					class="ml-auto px-2 py-0.5 text-xs text-white bg-red-500 hover:bg-red-600 rounded shrink-0">
					Retry
				</button>
			{:else if buildStatus.state === 'checking'}
				<span class="text-gray-500 flex items-center gap-1">
					<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Checking build cache…
				</span>
			{:else}
				<!-- state === 'none' -->
				<span class="text-gray-500">No build yet</span>
				<button type="button" onclick={handleBuild}
					class="ml-auto px-2 py-0.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded">
					Build
				</button>
			{/if}
		</div>
	{:else if selectedEntrypoint && !connectedVfsNodeId}
		<p class="text-xs text-amber-600">No VFS node connected to this sandbox</p>
	{/if}

	<!-- Save selector -->
	{#if selectedEntrypoint && connectedStateNodeId}
		<div class="space-y-1.5">
			<span class="block text-xs font-medium text-gray-500">Save</span>
			{#if loadingSaves}
				<div class="flex items-center gap-1 text-xs text-gray-500">
					<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
					Loading saves…
				</div>
			{:else}
				<Dropdown
					items={saveDropdownItems}
					value={selectedSaveItem}
					placeholder="No save selected"
					size="sm"
					getLabel={(item) => {
						if (item.id === NONE_ID || item.id === CREATE_NEW_ID) return item.label;
						const badge = item.syncStatus === 'synced' ? '✅' : item.syncStatus === 'cloud-only' ? '☁️' : '💾';
						return `${badge} ${item.label}`;
					}}
					getKey={(item) => item.id}
					onchange={handleSaveSelect}
				/>
			{/if}

			<!-- Create new save form -->
			{#if showCreateForm}
				<div class="rounded border border-gray-200 bg-gray-50 p-2 space-y-2">
					<input
						type="text"
						bind:value={newSaveTitle}
						placeholder="Save title"
						class="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
					<input
						type="text"
						bind:value={newSaveDescription}
						placeholder="Description (optional)"
						class="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
					/>
					<div class="flex gap-1.5 justify-end">
						<button type="button" onclick={handleCancelCreate}
							class="px-2 py-0.5 text-xs text-gray-600 bg-gray-200 hover:bg-gray-300 rounded"
							disabled={isCreatingSave}>
							Cancel
						</button>
						<button type="button" onclick={handleCreateSave}
							class="px-2 py-0.5 text-xs text-white bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
							disabled={isCreatingSave || !newSaveTitle.trim()}>
							{#if isCreatingSave}Creating…{:else}Create{/if}
						</button>
					</div>
				</div>
			{/if}
		</div>
	{:else if selectedEntrypoint && !connectedStateNodeId}
		<p class="text-xs text-amber-600">No STATE node connected — saves unavailable</p>
	{/if}
</div>
