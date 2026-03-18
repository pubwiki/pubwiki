<script lang="ts">
	/**
	 * StateProperties - Properties panel for State nodes
	 * Displays RDF triples and save panel with local/cloud checkpoints
	 */
	import { VirtualList } from 'flowbite-svelte';
	import type { StateNodeData } from '$lib/types';
	import { getNodeRDFStore, type TripleStore } from '$lib/rdf';
	import type { Triple, Value } from '@pubwiki/rdfstore';
	import SavePanel from './SavePanel.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: StateNodeData;
		projectId: string;
	}

	let { nodeId, data, projectId }: Props = $props();

	// State
	let triples = $state<Triple[]>([]);
	let isLoading = $state(false);
	let isExporting = $state(false);
	let isImporting = $state(false);
	let error = $state<string | null>(null);
	let store = $state<TripleStore | null>(null);
	let fileInput: HTMLInputElement;

	// Convert a triple value to display string
	function valueToString(val: Value): string {
		if (val === null || val === undefined) return '';
		if (typeof val === 'string') return `"${val}"`;
		if (typeof val === 'number' || typeof val === 'boolean') return String(val);
		if (typeof val === 'object') return JSON.stringify(val);
		return String(val);
	}

	// Refresh triples from store
	async function refreshTriples() {
		isLoading = true;
		error = null;
		
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			triples = store.getAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load triples';
			triples = [];
		} finally {
			isLoading = false;
		}
	}

	// Export state to file
	async function exportState() {
		isExporting = true;
		error = null;
		
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			
			const state = store.exportState();
			const jsonStr = JSON.stringify(state, null, 2);
			const filename = `${nodeId}-state.json`;
			
			// Create blob and trigger download
			const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to export state';
		} finally {
			isExporting = false;
		}
	}

	// Import state from file
	async function importState(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		
		isImporting = true;
		error = null;
		
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			
			const jsonStr = await file.text();
			const state = JSON.parse(jsonStr);
			store.importState(state);
			
			// Refresh triples after import
			triples = store.getAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to import state';
		} finally {
			isImporting = false;
			// Reset file input
			target.value = '';
		}
	}

	// Trigger file input click
	function triggerImport() {
		fileInput?.click();
	}
</script>

<div class="space-y-6">
	<!-- Save Panel -->
	<SavePanel {nodeId} {data} {projectId} />

	<!-- Divider -->
	<div class="border-t border-gray-200"></div>

	<!-- RDF Triples Section -->
	<div class="space-y-3">
		<!-- Hidden file input for import -->
		<input
			type="file"
			accept=".json"
		class="hidden"
		bind:this={fileInput}
		onchange={importState}
	/>

	<!-- Header with refresh button -->
	<div class="flex items-center justify-between">
		<span class="text-xs font-medium text-gray-500">Triples</span>
		<button
			type="button"
			onclick={refreshTriples}
			disabled={isLoading}
			class="text-sm text-teal-600 hover:text-teal-700 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
		>
			{#if isLoading}
				<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				{m.studio_loading()}
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				{m.studio_state_refresh()}
			{/if}
		</button>
	</div>

	<!-- Import/Export buttons -->
	<div class="flex flex-wrap items-center gap-2">
		<!-- Import button -->
		<button
			type="button"
			onclick={triggerImport}
			disabled={isImporting}
			class="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg flex items-center gap-1.5 transition-colors"
		>
			{#if isImporting}
				<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				{m.studio_loading()}
			{:else}
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
				</svg>
				{m.studio_state_import()}
			{/if}
		</button>

		<!-- Export button -->
		<button
			type="button"
			onclick={exportState}
			disabled={isExporting || triples.length === 0}
			class="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed rounded-lg flex items-center gap-1.5 transition-colors"
		>
			{#if isExporting}
				<svg class="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
				</svg>
				{m.studio_loading()}
			{:else}
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
				</svg>
				{m.studio_state_export()}
			{/if}
		</button>
	</div>

	<!-- Error message -->
	{#if error}
		<div class="px-3 py-2 text-xs bg-red-50 text-red-600 rounded-lg border border-red-200">
			{error}
		</div>
	{/if}

	<!-- Triples table -->
	<div class="rounded-lg border border-gray-200 overflow-hidden">
		<!-- Table header -->
		<div class="grid grid-cols-3 gap-1 px-2 py-1.5 bg-gray-100 border-b border-gray-200 text-xs font-medium text-gray-600">
			<div>Subject</div>
			<div>Predicate</div>
			<div>Object</div>
		</div>

		<!-- Table body with virtual list -->
		<div class="bg-white">
			{#if triples.length > 0}
				<VirtualList items={triples} minItemHeight={32} height={300}>
					{#snippet children(item, index)}
						<div 
							class="grid grid-cols-3 gap-1 px-2 py-1.5 text-xs border-b border-gray-100 last:border-b-0 hover:bg-gray-50
								{index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}"
						>
							<div class="font-mono text-gray-700 truncate" title={item.subject}>
								{item.subject}
							</div>
							<div class="font-mono text-blue-600 truncate" title={item.predicate}>
								{item.predicate}
							</div>
							<div class="font-mono text-green-600 truncate" title={valueToString(item.object)}>
								{valueToString(item.object)}
							</div>
						</div>
					{/snippet}
				</VirtualList>
			{:else if !isLoading}
				<div class="px-3 py-8 text-sm text-gray-400 text-center">
					{#if error}
						{m.studio_state_error()}
					{:else}
						Click refresh to load triples
					{/if}
				</div>
			{:else}
				<div class="px-3 py-8 text-sm text-gray-400 text-center">
					{m.studio_loading()}
				</div>
			{/if}
		</div>
	</div>

	<!-- Triple count -->
	<p class="text-xs text-gray-500">
		{#if triples.length > 0}
			{m.studio_state_triples()}: {triples.length}
		{:else}
			Click refresh to load triples from store
		{/if}
	</p>
	</div>
</div>
