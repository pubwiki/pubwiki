<script lang="ts">
	/**
	 * StateNode - RDF Triple Store node for Lua State API
	 * 
	 * Features:
	 * - Provides RDF triple store (quadstore) for Lua scripts
	 * - Displays store status and triple count
	 * - Auto-initializes on mount, cleanup on unmount
	 * - Uses BaseNode for consistent styling
	 */
	import { Position, type NodeProps, type Node } from '@xyflow/svelte';
	import { onMount, onDestroy } from 'svelte';
	import type { StateNodeData } from '../../../types';
	import { getStudioContext } from '../../../state';
	import { getNodeRDFStore, closeNodeRDFStore, type QuadstoreRDFStore } from '../../../rdf';
	import BaseNode from '../BaseNode.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<StateNodeData, 'state'>> = $props();
	const ctx = getStudioContext();

	// ============================================================================
	// State
	// ============================================================================

	let store = $state<QuadstoreRDFStore | null>(null);
	let isInitializing = $state(false);

	// ============================================================================
	// Lifecycle
	// ============================================================================

	onMount(async () => {
		await initializeStore();
	});

	onDestroy(async () => {
		await closeNodeRDFStore(id);
	});

	// ============================================================================
	// Store Management
	// ============================================================================

	async function initializeStore() {
		if (isInitializing || store) return;
		
		isInitializing = true;
		try {
			store = await getNodeRDFStore(id);
			
			// Update node data with ready state
			ctx.updateNode(id, (nodeData) => ({
				...nodeData,
				isReady: true,
				error: null
			}));

			// Get initial triple count
			await updateTripleCount();
		} catch (e) {
			const errorMsg = e instanceof Error ? e.message : 'Failed to initialize RDF store';
			ctx.updateNode(id, (nodeData) => ({
				...nodeData,
				isReady: false,
				error: errorMsg
			}));
		} finally {
			isInitializing = false;
		}
	}

	async function updateTripleCount() {
		if (!store) return;
		
		try {
			// Query all triples to get count
			const triples = await store.query({});
			ctx.updateNode(id, (nodeData) => ({
				...nodeData,
				tripleCount: triples.length
			}));
		} catch (e) {
			console.error('[StateNode] Failed to get triple count:', e);
		}
	}

	async function clearStore() {
		if (!store) return;
		
		try {
			// Get all triples and delete them
			const triples = await store.query({});
			for (const triple of triples) {
				await store.delete(triple.subject, triple.predicate, triple.object);
			}
			
			ctx.updateNode(id, (nodeData) => ({
				...nodeData,
				tripleCount: 0
			}));
		} catch (e) {
			console.error('[StateNode] Failed to clear store:', e);
		}
	}

	// ============================================================================
	// Derived
	// ============================================================================

	const statusColor = $derived(
		data.error ? 'red' : data.isReady ? 'green' : 'gray'
	);

	const statusText = $derived(
		data.error ? m.studio_state_error() : data.isReady ? m.studio_state_ready() : isInitializing ? m.studio_state_initializing() : m.studio_state_idle()
	);
</script>

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="STATE"
	headerBgClass="bg-teal-500"
	handleBgClass="bg-teal-400!"
	showLeftHandle={false}
	showRightHandle={true}
>
	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		<!-- Refresh triple count button -->
		<button
			class="p-1 text-white/70 hover:text-white hover:bg-white/10 rounded transition-colors nodrag"
			onclick={updateTripleCount}
			title={m.studio_node_refresh_triples()}
		>
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
			</svg>
		</button>
	{/snippet}

	{#snippet children()}
		<div class="p-3 bg-gray-50 space-y-3">
			<!-- Status Display -->
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-gray-500">{m.studio_state_status()}</span>
				<div class="flex items-center gap-1.5">
					<span class="w-2 h-2 rounded-full {statusColor === 'green' ? 'bg-green-500' : statusColor === 'red' ? 'bg-red-500' : 'bg-gray-400'}"></span>
					<span class="text-xs {statusColor === 'green' ? 'text-green-600' : statusColor === 'red' ? 'text-red-600' : 'text-gray-500'}">
						{statusText}
					</span>
				</div>
			</div>

			<!-- Triple Count -->
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-gray-500">{m.studio_state_triples()}</span>
				<span class="text-sm font-mono text-gray-700">{data.tripleCount}</span>
			</div>

			<!-- Error Display -->
			{#if data.error}
				<div class="px-2 py-1.5 text-xs bg-red-50 text-red-600 rounded-lg border border-red-200">
					{data.error}
				</div>
			{/if}

			<!-- Info Section -->
			<div class="pt-2 border-t border-gray-200">
				<p class="text-xs text-gray-400">
					{m.studio_state_desc()}
				</p>
			</div>

			<!-- Actions -->
			<div class="flex gap-2">
				<button
					class="flex-1 px-2 py-1.5 text-xs bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors nodrag"
					onclick={updateTripleCount}
					disabled={!data.isReady}
				>
					{m.studio_state_refresh()}
				</button>
				<button
					class="flex-1 px-2 py-1.5 text-xs bg-red-100 text-red-600 rounded-lg hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors nodrag"
					onclick={clearStore}
					disabled={!data.isReady || data.tripleCount === 0}
				>
					{m.studio_state_clear()}
				</button>
			</div>
		</div>
	{/snippet}
</BaseNode>
