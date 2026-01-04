<script lang="ts">
	import { VirtualList } from 'flowbite-svelte';
	import { onMount } from 'svelte';
	import type { SettingsStore, ApiProviderKey } from '$lib/stores/settings.svelte';
	import { API_PROVIDERS } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		settings: SettingsStore;
	}

	let { settings }: Props = $props();

	// Local state for form inputs - initialized in onMount
	let provider = $state<ApiProviderKey>('openai');
	let customBaseUrl = $state('');
	let apiKey = $state('');
	let selectedModel = $state('');

	// Initialize from settings on mount
	onMount(() => {
		provider = settings.api.provider;
		customBaseUrl = settings.api.customBaseUrl;
		apiKey = settings.api.apiKey;
		selectedModel = settings.api.selectedModel;
	});

	// Model fetching state
	let models = $state<string[]>([]);
	let isLoadingModels = $state(false);
	let modelsError = $state('');
	let showModelDropdown = $state(false);
	let modelSearchQuery = $state('');

	// Filtered models based on search
	let filteredModels = $derived(
		modelSearchQuery
			? models.filter((m) => m.toLowerCase().includes(modelSearchQuery.toLowerCase()))
			: models
	);

	// Update settings when provider changes
	function handleProviderChange(newProvider: ApiProviderKey) {
		provider = newProvider;
		settings.setProvider(newProvider);
		selectedModel = '';
		settings.setSelectedModel('');
		models = [];
		modelsError = '';
	}

	// Update settings when custom base URL changes
	function handleCustomBaseUrlChange(url: string) {
		customBaseUrl = url;
		settings.setCustomBaseUrl(url);
		// Reset models when URL changes
		models = [];
		selectedModel = '';
		settings.setSelectedModel('');
	}

	// Update settings when API key changes
	function handleApiKeyChange(key: string) {
		apiKey = key;
		settings.setApiKey(key);
		// Reset models when key changes
		models = [];
		modelsError = '';
	}

	// Fetch models from API
	async function fetchModels() {
		if (!apiKey) {
			modelsError = m.studio_api_enter_key_first();
			return;
		}

		const baseUrl = provider === 'custom' ? customBaseUrl : API_PROVIDERS[provider].baseUrl;
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
		} catch (error) {
			modelsError = m.studio_api_fetch_failed();
		} finally {
			isLoadingModels = false;
		}
	}

	// Handle model selection
	function handleModelSelect(model: string) {
		selectedModel = model;
		settings.setSelectedModel(model);
		showModelDropdown = false;
		modelSearchQuery = '';
	}

	// Provider options for dropdown
	const providerOptions = Object.entries(API_PROVIDERS).map(([key, value]) => ({
		key: key as ApiProviderKey,
		...value
	}));
</script>

<div class="p-6 space-y-6">
	<div>
		<h3 class="text-lg font-medium text-gray-900 mb-1">{m.studio_api_config()}</h3>
		<p class="text-sm text-gray-500">{m.studio_api_config_desc()}</p>
	</div>

	<!-- API Provider Selection -->
	<div class="space-y-2">
		<label for="provider" class="block text-sm font-medium text-gray-700">
			{m.studio_api_provider()}
		</label>
		<select
			id="provider"
			value={provider}
			onchange={(e) => handleProviderChange(e.currentTarget.value as ApiProviderKey)}
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
		>
			{#each providerOptions as option}
				<option value={option.key}>{option.name}</option>
			{/each}
		</select>
		<p class="text-xs text-gray-500">
			{#if provider === 'custom'}
				{m.studio_api_custom_hint()}
			{:else}
				{m.studio_api_using({ url: API_PROVIDERS[provider].baseUrl })}
			{/if}
		</p>
	</div>

	<!-- Custom Base URL (only shown for custom provider) -->
	{#if provider === 'custom'}
		<div class="space-y-2">
			<label for="baseUrl" class="block text-sm font-medium text-gray-700">
				{m.studio_api_custom_url()}
			</label>
			<input
				id="baseUrl"
				type="url"
				value={customBaseUrl}
				oninput={(e) => handleCustomBaseUrlChange(e.currentTarget.value)}
				placeholder={m.studio_api_custom_url_placeholder()}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
			/>
			<p class="text-xs text-gray-500">
				{m.studio_api_custom_url_hint()}
			</p>
		</div>
	{/if}

	<!-- API Key Input -->
	<div class="space-y-2">
		<label for="apiKey" class="block text-sm font-medium text-gray-700">
			{m.studio_api_key()}
		</label>
		<div class="relative">
			<input
				id="apiKey"
				type="password"
				value={apiKey}
				oninput={(e) => handleApiKeyChange(e.currentTarget.value)}
				placeholder={m.studio_api_key_placeholder()}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
			/>
			<div class="absolute inset-y-0 right-0 flex items-center pr-3">
				<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
				</svg>
			</div>
		</div>
		<p class="text-xs text-gray-500">
			{m.studio_api_key_hint()}
		</p>
	</div>

	<!-- Model Selection -->
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<label for="model" class="block text-sm font-medium text-gray-700">
				{m.studio_api_model()}
			</label>
			<button
				type="button"
				onclick={fetchModels}
				disabled={isLoadingModels || !apiKey}
				class="text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
			>
				{#if isLoadingModels}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					{m.studio_api_loading_models()}
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					{m.studio_api_fetch_models()}
				{/if}
			</button>
		</div>

		<!-- Model dropdown with virtual list -->
		<div class="relative">
			<button
				type="button"
				onclick={() => {
					if (models.length > 0) showModelDropdown = !showModelDropdown;
				}}
				disabled={models.length === 0}
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white text-left flex items-center justify-between disabled:bg-gray-50 disabled:cursor-not-allowed"
			>
				<span class={selectedModel ? 'text-gray-900' : 'text-gray-400'}>
					{selectedModel || (models.length > 0 ? m.studio_api_select_model() : m.studio_api_fetch_first())}
				</span>
				<svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			<!-- Dropdown with virtual list -->
			{#if showModelDropdown && models.length > 0}
				<div class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
					<!-- Search input -->
					<div class="p-2 border-b border-gray-200">
						<input
							type="text"
							bind:value={modelSearchQuery}
							placeholder={m.studio_api_search_models()}
							class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						/>
					</div>

					<!-- Virtual list for models -->
					<div class="max-h-60">
						{#if filteredModels.length > 0}
							<VirtualList items={filteredModels} minItemHeight={40} height={240}>
								{#snippet children(item, index)}
									<button
										type="button"
										class="w-full px-3 py-2 text-left text-sm hover:bg-gray-100 transition-colors border-b border-gray-100 last:border-b-0
											{item === selectedModel ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}"
										onclick={() => handleModelSelect(item as string)}
									>
										{item}
									</button>
								{/snippet}
							</VirtualList>
						{:else}
							<div class="px-3 py-4 text-sm text-gray-500 text-center">
								{m.studio_api_no_match()}
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		{#if modelsError}
			<p class="text-xs text-red-500">{modelsError}</p>
		{:else if models.length > 0}
			<p class="text-xs text-gray-500">{m.studio_api_models_available({ count: models.length })}</p>
		{:else}
			<p class="text-xs text-gray-500">{m.studio_api_fetch_hint()}</p>
		{/if}
	</div>

	<!-- Status summary -->
	<div class="mt-6 p-4 bg-gray-50 rounded-lg">
		<h4 class="text-sm font-medium text-gray-700 mb-2">{m.studio_api_current_config()}</h4>
		<div class="space-y-1 text-sm text-gray-600">
			<div class="flex justify-between">
				<span>{m.studio_api_provider_label()}:</span>
				<span class="font-medium">{API_PROVIDERS[provider].name}</span>
			</div>
			<div class="flex justify-between">
				<span>{m.studio_api_key_label()}:</span>
				<span class="font-medium">{apiKey ? '••••••••' + apiKey.slice(-4) : m.studio_api_key_not_set()}</span>
			</div>
			<div class="flex justify-between">
				<span>{m.studio_api_model_label()}:</span>
				<span class="font-medium">{selectedModel || m.studio_api_model_not_selected()}</span>
			</div>
		</div>
	</div>
</div>

<!-- Click outside to close dropdown -->
<svelte:window
	onclick={(e) => {
		const target = e.target as HTMLElement;
		if (showModelDropdown && !target.closest('.relative')) {
			showModelDropdown = false;
		}
	}}
/>
