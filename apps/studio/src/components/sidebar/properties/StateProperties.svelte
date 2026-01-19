<script lang="ts">
	/**
	 * StateProperties - Properties panel for State nodes
	 * Displays RDF quads in a virtualized table with manual refresh
	 * Supports import/export of RDF data
	 */
	import { VirtualList } from 'flowbite-svelte';
	import { Dropdown } from '@pubwiki/ui/components';
	import type { StateNodeData } from '$lib/types';
	import { getNodeRDFStore, type RDFStore } from '$lib/rdf';
	import type { Quad, SerializationFormat } from '@pubwiki/rdfstore';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: StateNodeData;
	}

	let { nodeId, data }: Props = $props();

	// State
	let quads = $state<Quad[]>([]);
	let isLoading = $state(false);
	let isExporting = $state(false);
	let isImporting = $state(false);
	let error = $state<string | null>(null);
	let store = $state<RDFStore | null>(null);
	let fileInput: HTMLInputElement;

	// Export format options
	type ExportFormat = { value: SerializationFormat; label: string; ext: string };
	const exportFormats: ExportFormat[] = [
		{ value: 'jsonl', label: 'JSON Lines', ext: 'jsonl' },
		{ value: 'nquads', label: 'N-Quads', ext: 'nq' },
		{ value: 'json', label: 'JSON', ext: 'json' },
		{ value: 'compact-json', label: 'Compact JSON', ext: 'json' }
	];
	let selectedFormat = $state<ExportFormat>(exportFormats[0]);

	// Convert RDF term to display string
	function termToString(term: Quad['subject'] | Quad['predicate'] | Quad['object'] | Quad['graph']): string {
		if (!term) return '';
		if (term.termType === 'NamedNode') {
			return term.value;
		}
		if (term.termType === 'Literal') {
			const datatype = term.datatype?.value;
			if (datatype && datatype !== 'http://www.w3.org/2001/XMLSchema#string') {
				// Show datatype suffix for non-string literals
				const shortType = datatype.split('#').pop() || datatype.split('/').pop();
				return `"${term.value}"^^${shortType}`;
			}
			return `"${term.value}"`;
		}
		if (term.termType === 'BlankNode') {
			return `_:${term.value}`;
		}
		if (term.termType === 'DefaultGraph') {
			return '(default)';
		}
		return String(term.value);
	}

	// Refresh quads from store
	async function refreshQuads() {
		isLoading = true;
		error = null;
		
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			quads = await store.getAllQuads();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to load quads';
			quads = [];
		} finally {
			isLoading = false;
		}
	}

	// Export quads to file
	async function exportQuads() {
		isExporting = true;
		error = null;
		
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			
			const data = await store.exportData({ format: selectedFormat.value });
			const filename = `${nodeId}-quads.${selectedFormat.ext}`;
			
			// Create blob and trigger download
			const blob = new Blob([data], { type: 'text/plain;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to export quads';
		} finally {
			isExporting = false;
		}
	}

	// Import quads from file
	async function importQuads(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		
		isImporting = true;
		error = null;
		
		try {
			if (!store) {
				store = await getNodeRDFStore(nodeId);
			}
			
			const data = await file.text();
			await store.importData(data);
			
			// Refresh quads after import
			quads = await store.getAllQuads();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to import quads';
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

<div class="space-y-3">
	<!-- Hidden file input for import -->
	<input
		type="file"
		accept=".jsonl,.nq,.json,.txt"
		class="hidden"
		bind:this={fileInput}
		onchange={importQuads}
	/>

	<!-- Header with refresh button -->
	<div class="flex items-center justify-between">
		<span class="text-xs font-medium text-gray-500">RDF Quads</span>
		<button
			type="button"
			onclick={refreshQuads}
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

		<!-- Export section -->
		<div class="flex items-center gap-1">
			<!-- Format selector -->
			<Dropdown
				items={exportFormats}
				bind:value={selectedFormat}
				getLabel={(f) => f.label}
				getKey={(f) => f.value}
				size="sm"
				class="w-32"
			/>

			<!-- Export button -->
			<button
				type="button"
				onclick={exportQuads}
				disabled={isExporting || quads.length === 0}
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
	</div>

	<!-- Error message -->
	{#if error}
		<div class="px-3 py-2 text-xs bg-red-50 text-red-600 rounded-lg border border-red-200">
			{error}
		</div>
	{/if}

	<!-- Quads table -->
	<div class="rounded-lg border border-gray-200 overflow-hidden">
		<!-- Table header -->
		<div class="grid grid-cols-4 gap-1 px-2 py-1.5 bg-gray-100 border-b border-gray-200 text-xs font-medium text-gray-600">
			<div>Subject</div>
			<div>Predicate</div>
			<div>Object</div>
			<div>Graph</div>
		</div>

		<!-- Table body with virtual list -->
		<div class="bg-white">
			{#if quads.length > 0}
				<VirtualList items={quads} minItemHeight={32} height={300}>
					{#snippet children(item, index)}
						<div 
							class="grid grid-cols-4 gap-1 px-2 py-1.5 text-xs border-b border-gray-100 last:border-b-0 hover:bg-gray-50
								{index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}"
						>
							<div class="font-mono text-gray-700 truncate" title={termToString(item.subject)}>
								{termToString(item.subject)}
							</div>
							<div class="font-mono text-blue-600 truncate" title={termToString(item.predicate)}>
								{termToString(item.predicate)}
							</div>
							<div class="font-mono text-green-600 truncate" title={termToString(item.object)}>
								{termToString(item.object)}
							</div>
							<div class="font-mono text-gray-400 truncate" title={termToString(item.graph)}>
								{termToString(item.graph)}
							</div>
						</div>
					{/snippet}
				</VirtualList>
			{:else if !isLoading}
				<div class="px-3 py-8 text-sm text-gray-400 text-center">
					{#if error}
						{m.studio_state_error()}
					{:else}
						Click refresh to load quads
					{/if}
				</div>
			{:else}
				<div class="px-3 py-8 text-sm text-gray-400 text-center">
					{m.studio_loading()}
				</div>
			{/if}
		</div>
	</div>

	<!-- Quad count -->
	<p class="text-xs text-gray-500">
		{#if quads.length > 0}
			{m.studio_state_triples()}: {quads.length}
		{:else}
			Click refresh to load quads from store
		{/if}
	</p>
</div>
