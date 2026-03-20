<script lang="ts">
	/**
	 * InputProperties - Properties panel for INPUT nodes
	 * Includes content editor and generation settings (model, temperature, schema)
	 */
	import type { InputNodeData, ContentBlock, InputGenerationConfig } from '$lib/types';
	import { nodeStore } from '$lib/persistence/node-store.svelte';
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import { VirtualizedDropdown } from '@pubwiki/ui/components';
	import { RefTagEditor } from '../../editor';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodeId: string;
		data: InputNodeData;
		onGenerate: () => void;
	}

	let { nodeId, data, onGenerate }: Props = $props();

	const settings = getSettingsStore();

	// Model fetching state
	let models = $state<string[]>([]);
	let isLoadingModels = $state(false);
	let modelsError = $state('');

	// Get generation config directly from nodeStore for reactivity
	let generationConfig = $derived.by(() => {
		const currentData = nodeStore.get(nodeId) as InputNodeData | undefined;
		return currentData?.content.generationConfig;
	});

	// Fetch models from API
	async function fetchModels() {
		if (!settings.api.apiKey) {
			modelsError = m.studio_api_enter_key_first();
			return;
		}

		const baseUrl = settings.effectiveBaseUrl;
		if (!baseUrl) {
			modelsError = m.studio_api_enter_url_first();
			return;
		}

		isLoadingModels = true;
		modelsError = '';

		try {
			const fetchedModels = await settings.fetchModels();
			if (fetchedModels.length === 0) {
				modelsError = m.studio_api_no_models();
			} else {
				models = fetchedModels;
			}
		} catch (_error) {
			modelsError = m.studio_api_fetch_failed();
		} finally {
			isLoadingModels = false;
		}
	}

	// Handle model selection
	function handleModelSelect(model: string) {
		handleGenerationConfigChange('model', model);
	}

	// Content block change handler
	function handleBlocksChange(newBlocks: ContentBlock[]) {
		nodeStore.update(nodeId, (nodeData) => {
			const inputData = nodeData as InputNodeData;
			return { ...inputData, content: inputData.content.withBlocks(newBlocks) };
		});
	}

	// Handle generation config changes
	function handleGenerationConfigChange(field: keyof InputGenerationConfig, value: string | number | undefined) {
		console.log('[InputProperties] handleGenerationConfigChange:', { field, value });
		nodeStore.update(nodeId, (nodeData) => {
			const inputData = nodeData as InputNodeData;
			const newContent = inputData.content.withGenerationConfig({ [field]: value });
			console.log('[InputProperties] updated generationConfig:', newContent.generationConfig);
			return {
				...inputData,
				content: newContent
			};
		});
	}
</script>

<div class="flex items-center justify-between mb-2">
	<span class="text-xs font-medium text-gray-500">{m.studio_properties_content()}</span>
	<button
		class="px-2 py-1 text-xs font-medium bg-purple-500 hover:bg-purple-600 text-white rounded transition-colors flex items-center gap-1"
		onclick={onGenerate}
	>
		<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
		</svg>
		{m.studio_properties_generate()}
	</button>
</div>

<!-- Content editor -->
<div class="rounded-lg border border-gray-200 min-h-48">
	<div class="properties-textarea">
		<RefTagEditor
			value={data.content.blocks}
			placeholder={m.studio_properties_enter_content()}
			onchange={handleBlocksChange}
			autoHeight
		/>
	</div>
</div>

<!-- Generation Config Section -->
<div class="mt-4 space-y-3">
	<span class="block text-xs font-medium text-gray-500">{m.studio_properties_generation_settings()}</span>
	
	<!-- Model Selection with Fetch Button -->
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<span class="text-xs text-gray-500">{m.studio_properties_model()}</span>
			<button
				type="button"
				onclick={fetchModels}
				disabled={isLoadingModels || !settings.api.apiKey}
				class="text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
			>
				{#if isLoadingModels}
					<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					{m.studio_api_loading_models()}
				{:else}
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					{m.studio_api_fetch_models()}
				{/if}
			</button>
		</div>

		<!-- Model dropdown -->
		<VirtualizedDropdown
			items={models}
			value={generationConfig?.model}
			placeholder={models.length > 0 ? m.studio_api_select_model() : m.studio_properties_model_placeholder()}
			searchPlaceholder={m.studio_api_search_models()}
			noMatchText={m.studio_api_no_match()}
			onchange={handleModelSelect}
			listHeight={160}
			size="sm"
		/>

		{#if modelsError}
			<p class="text-xs text-red-500">{modelsError}</p>
		{:else if models.length > 0}
			<p class="text-xs text-gray-400">{m.studio_api_models_available({ count: models.length })}</p>
		{:else}
			<p class="text-xs text-gray-400">{m.studio_api_fetch_hint()}</p>
		{/if}
	</div>
	
	<!-- Temperature -->
	<div>
		<span class="block text-xs text-gray-500 mb-1">{m.studio_properties_temperature()}</span>
		<div class="flex items-center gap-2">
			<input
				type="range"
				min="0"
				max="2"
				step="0.1"
				value={generationConfig?.temperature ?? 1}
				oninput={(e) => {
					const value = parseFloat((e.target as HTMLInputElement).value);
					handleGenerationConfigChange('temperature', value);
				}}
				class="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-500"
			/>
			<span class="text-xs text-gray-500 w-8 text-right">{generationConfig?.temperature?.toFixed(1) ?? '—'}</span>
		</div>
	</div>
	
	<!-- JSON Schema -->
	<div>
		<span class="block text-xs text-gray-500 mb-1">{m.studio_properties_schema()}</span>
		<textarea
			value={generationConfig?.schema || ''}
			oninput={(e) => handleGenerationConfigChange('schema', (e.target as HTMLTextAreaElement).value)}
			placeholder={m.studio_properties_schema_placeholder()}
			rows={3}
			class="w-full px-3 py-2 text-sm font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
		></textarea>
	</div>
</div>

<style>
	.properties-textarea :global(.rich-text-area) {
		min-height: 12rem;
		max-height: none;
		height: auto;
		overflow: visible;
	}

	.properties-textarea :global(.backdrop) {
		position: relative;
		right: 0;
		padding-right: 0.75rem;
		min-height: 12rem;
	}

	.properties-textarea :global(.input) {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		min-height: 12rem;
		height: 100%;
		overflow: hidden;
		resize: none;
	}
</style>
