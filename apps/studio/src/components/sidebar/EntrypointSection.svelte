<script lang="ts">
	/**
	 * EntrypointSection - Entrypoint selection and build status UI
	 *
	 * Displays a dropdown of sandbox nodes in the graph, resolves the
	 * connected VFS node, and shows build status / actions.
	 *
	 * Build status is derived from:
	 *   - Local transient state: building / error (component-scoped $state)
	 *   - OPFS cache:  checked on mount, after builds, and when
	 *     writeVersion changes.  OpfsBuildCacheStorage is the source
	 *     of truth for whether a valid build exists.
	 *
	 * Stale detection uses NodeVfs.writeVersion — a monotonic counter
	 * bumped on every file event.  After a successful OPFS check (or
	 * build), we record the writeVersion.  If the live value differs
	 * later, we mark the build as stale.
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { FlowNodeData } from '$lib/types/flow';
	import type { VFSNodeData } from '$lib/types';
	import { nodeStore } from '$lib/persistence/node-store.svelte';
	import { Dropdown } from '@pubwiki/ui/components';
	import { runBuild } from '$lib/io/build-runner';
	import { getNodeVfs } from '$lib/vfs';
	import { OpfsBuildCacheStorage, detectProject } from '@pubwiki/bundler';
	import { computeBuildCacheKey } from '@pubwiki/api';
	import { computeVfsContentHash } from '$lib/io/vfs-content-hash';

	export type BuildStatus =
		| { state: 'none' }
		| { state: 'building'; message?: string }
		| { state: 'ready' }
		| { state: 'stale' }
		| { state: 'error'; message: string };

	interface Props {
		nodes: Node<FlowNodeData>[];
		edges: Edge[];
		projectId: string;
		/** Selected sandbox node ID — persisted by parent */
		selectedEntrypoint: string | null;
		onEntrypointChange: (sandboxNodeId: string | null) => void;
		/** Called when the resolved buildCacheKey changes (null = no valid cache). */
		onBuildCacheKeyChange?: (key: string | null) => void;
	}

	let { nodes, edges, projectId, selectedEntrypoint, onEntrypointChange, onBuildCacheKeyChange }: Props = $props();

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

	// ---- VFS writeVersion for stale detection ----
	// Two-phase reactive pattern:
	//   1. $effect resolves the NodeVfs instance (async) → stored in $state
	//   2. $derived reads .writeVersion from the instance (reactive — writeVersion is $state)
	let nodeVfs: { writeVersion: number } | null = $state(null);
	$effect(() => {
		const vfsId = connectedVfsNodeId;
		if (!vfsId) { nodeVfs = null; return; }
		const data = nodeStore.get(vfsId) as VFSNodeData | undefined;
		if (!data || data.type !== 'VFS') { nodeVfs = null; return; }
		let cancelled = false;
		getNodeVfs(data.content.projectId, vfsId).then(vfs => {
			if (!cancelled) nodeVfs = vfs;
		});
		return () => { cancelled = true; };
	});

	let currentWriteVersion = $derived.by(() => {
		const vfs = nodeVfs;
		return vfs ? vfs.writeVersion : 0;
	});

	// ---- Transient build state (component-local) ----
	let building = $state(false);
	let buildingMessage = $state<string | undefined>(undefined);
	let buildError = $state<string | null>(null);

	// ---- OPFS cache status ----
	// The writeVersion at which we last confirmed a valid OPFS cache.
	// When currentWriteVersion diverges, the build is considered stale.
	let cacheCheckWriteVersion = $state<number | null>(null);
	// Whether the OPFS cache matched at cacheCheckWriteVersion.
	let opfsCacheValid = $state(false);
	// The buildCacheKey from the last successful check (for publish).
	let lastBuildCacheKey = $state<string | null>(null);

	// Notify parent when the resolved buildCacheKey changes
	$effect(() => {
		onBuildCacheKeyChange?.(lastBuildCacheKey);
	});

	// Shared OpfsBuildCacheStorage singleton (lazy, session-scoped)
	const buildCacheStorage = new OpfsBuildCacheStorage();

	/**
	 * Check whether OPFS has a valid build for the current VFS content.
	 * Sets opfsCacheValid + cacheCheckWriteVersion on success.
	 */
	async function checkOpfsCache(vfsId: string): Promise<void> {
		try {
			const data = nodeStore.get(vfsId) as VFSNodeData | undefined;
			if (!data || data.type !== 'VFS') { opfsCacheValid = false; return; }

			const nodeVfsInstance = await getNodeVfs(data.content.projectId, vfsId);
			const contentHash = await computeVfsContentHash(data.content.projectId, vfsId);
			const config = await detectProject('/tsconfig.json', nodeVfsInstance);
			if (!config?.isBuildable || config.entryFiles.length === 0) {
				opfsCacheValid = false;
				return;
			}
			const key = await computeBuildCacheKey({
				filesHash: contentHash,
				entryFiles: config.entryFiles,
			});
			const hasCached = await buildCacheStorage.has(key);
			opfsCacheValid = hasCached;
			lastBuildCacheKey = hasCached ? key : null;
			cacheCheckWriteVersion = nodeVfsInstance.writeVersion;
		} catch {
			opfsCacheValid = false;
		}
	}

	// Check OPFS cache on mount / when VFS node changes
	$effect(() => {
		const vfsId = connectedVfsNodeId;
		if (!vfsId) {
			opfsCacheValid = false;
			cacheCheckWriteVersion = null;
			lastBuildCacheKey = null;
			return;
		}
		let cancelled = false;
		checkOpfsCache(vfsId).then(() => {
			if (cancelled) return;
			// cacheCheckWriteVersion is set inside checkOpfsCache
		});
		return () => { cancelled = true; };
	});

	// Build status derivation
	let buildStatus: BuildStatus = $derived.by(() => {
		if (building) return { state: 'building' as const, message: buildingMessage };
		if (buildError) return { state: 'error' as const, message: buildError };
		if (opfsCacheValid && cacheCheckWriteVersion !== null) {
			if (currentWriteVersion !== cacheCheckWriteVersion) {
				return { state: 'stale' as const };
			}
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
				cacheCheckWriteVersion = nodeVfs?.writeVersion ?? currentWriteVersion;
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
</div>
