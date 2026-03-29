<script lang="ts">
	import { VirtualizedDropdown } from '../VirtualizedDropdown';
	import { onMount } from 'svelte';
	import {
		type SettingsStore,
		type ApiProviderKey,
		type ModelRole,
		API_PROVIDERS,
		MODEL_ROLES,
		getPresetsForProvider,
	} from '../../stores/settings.svelte';

	interface Props {
		settings: SettingsStore;
	}

	let { settings }: Props = $props();

	// Global provider state
	let provider = $state<ApiProviderKey>('openai');
	let customBaseUrl = $state('');
	let apiKey = $state('');

	// Global model list (fetched from global provider)
	let globalModels = $state<string[]>([]);
	let isLoadingGlobalModels = $state(false);
	let globalModelsError = $state('');

	// Per-role independent model lists
	let roleModels = $state<Record<ModelRole, string[]>>({
		narrative: [],
		recall: [],
		updater: [],
		designer: [],
	});
	let roleLoadingModels = $state<Record<ModelRole, boolean>>({
		narrative: false,
		recall: false,
		updater: false,
		designer: false,
	});
	let roleModelsError = $state<Record<ModelRole, string>>({
		narrative: '',
		recall: '',
		updater: '',
		designer: '',
	});

	onMount(() => {
		provider = settings.api.provider;
		customBaseUrl = settings.api.customBaseUrl;
		apiKey = settings.api.apiKey;
	});

	function handleProviderChange(newProvider: ApiProviderKey) {
		provider = newProvider;
		settings.setProvider(newProvider);
		globalModels = [];
		globalModelsError = '';
	}

	function handleCustomBaseUrlChange(url: string) {
		customBaseUrl = url;
		settings.setCustomBaseUrl(url);
		globalModels = [];
	}

	function handleApiKeyChange(key: string) {
		apiKey = key;
		settings.setApiKey(key);
		globalModels = [];
		globalModelsError = '';
	}

	async function fetchGlobalModels() {
		if (!apiKey) {
			globalModelsError = 'Please enter an API key first.';
			return;
		}
		const baseUrl = provider === 'custom' ? customBaseUrl : API_PROVIDERS[provider].baseUrl;
		if (!baseUrl) {
			globalModelsError = 'Please enter a base URL first.';
			return;
		}
		isLoadingGlobalModels = true;
		globalModelsError = '';
		try {
			const fetched = await settings.fetchModels();
			if (fetched.length === 0) {
				globalModelsError = 'No models found for this provider.';
			} else {
				globalModels = fetched;
			}
		} catch {
			globalModelsError = 'Failed to fetch models.';
		} finally {
			isLoadingGlobalModels = false;
		}
	}

	async function fetchRoleModels(role: ModelRole) {
		const rc = settings.api.modelRoles[role];
		if (!rc?.customBaseUrl || !rc?.customApiKey) {
			roleModelsError[role] = 'Please enter API URL and Key first.';
			return;
		}
		roleLoadingModels[role] = true;
		roleModelsError[role] = '';
		try {
			const fetched = await settings.fetchModels(rc.customBaseUrl, rc.customApiKey);
			if (fetched.length === 0) {
				roleModelsError[role] = 'No models found.';
			} else {
				roleModels[role] = fetched;
			}
		} catch {
			roleModelsError[role] = 'Failed to fetch models.';
		} finally {
			roleLoadingModels[role] = false;
		}
	}

	function handleRoleModelSelect(role: ModelRole, model: string) {
		settings.setModelRole(role, { model });
	}

	function handleRoleCustomProviderToggle(role: ModelRole, enabled: boolean) {
		settings.setModelRole(role, { useCustomProvider: enabled });
	}

	function handleRoleCustomBaseUrl(role: ModelRole, url: string) {
		settings.setModelRole(role, { customBaseUrl: url });
		roleModels[role] = [];
	}

	function handleRoleCustomApiKey(role: ModelRole, key: string) {
		settings.setModelRole(role, { customApiKey: key });
		roleModels[role] = [];
		roleModelsError[role] = '';
	}

	const providerOptions = Object.entries(API_PROVIDERS).map(([key, value]) => ({
		key: key as ApiProviderKey,
		...value,
	}));

	let availablePresets = $derived(getPresetsForProvider(provider));
</script>

<div class="p-6 space-y-6">
	<div>
		<h3 class="text-lg font-medium text-gray-900 mb-1">API Configuration</h3>
		<p class="text-sm text-gray-500">Configure your AI provider and model settings.</p>
	</div>

	<!-- API Provider Selection -->
	<div class="space-y-2">
		<label for="provider" class="block text-sm font-medium text-gray-700">Provider</label>
		<select
			id="provider"
			value={provider}
			onchange={(e) => handleProviderChange(e.currentTarget.value as ApiProviderKey)}
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
		>
			{#each providerOptions as option (option.key)}
				<option value={option.key}>{option.name}</option>
			{/each}
		</select>
		<p class="text-xs text-gray-500">
			{#if provider === 'custom'}
				Enter a custom OpenAI-compatible API endpoint.
			{:else}
				Using {API_PROVIDERS[provider].baseUrl}
			{/if}
		</p>
	</div>

	<!-- Custom Base URL -->
	{#if provider === 'custom'}
		<div class="space-y-2">
			<label for="baseUrl" class="block text-sm font-medium text-gray-700">Custom Base URL</label>
			<input
				id="baseUrl"
				type="url"
				value={customBaseUrl}
				oninput={(e) => handleCustomBaseUrlChange(e.currentTarget.value)}
				placeholder="https://api.example.com/v1"
				class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
			/>
		</div>
	{/if}

	<!-- API Key -->
	<div class="space-y-2">
		<label for="apiKey" class="block text-sm font-medium text-gray-700">API Key</label>
		<input
			id="apiKey"
			type="password"
			value={apiKey}
			oninput={(e) => handleApiKeyChange(e.currentTarget.value)}
			placeholder="sk-..."
			class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
		/>
		<p class="text-xs text-gray-500">Your API key is stored locally and never sent to our servers.</p>
	</div>

	<!-- Fetch Global Models -->
	<div class="space-y-2">
		<div class="flex items-center justify-between">
			<span class="block text-sm font-medium text-gray-700">Available Models</span>
			<button
				type="button"
				onclick={fetchGlobalModels}
				disabled={isLoadingGlobalModels || !apiKey}
				class="text-sm text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed flex items-center gap-1"
			>
				{#if isLoadingGlobalModels}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
					</svg>
					Loading...
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
					</svg>
					Fetch Models
				{/if}
			</button>
		</div>
		{#if globalModelsError}
			<p class="text-xs text-red-500">{globalModelsError}</p>
		{:else if globalModels.length > 0}
			<p class="text-xs text-gray-500">{globalModels.length} models available</p>
		{:else}
			<p class="text-xs text-gray-500">Click "Fetch Models" to load available models from your provider.</p>
		{/if}
	</div>

	<!-- Model Role Configuration -->
	<div class="space-y-1">
		<h4 class="text-sm font-semibold text-gray-900 pt-2 border-t border-gray-200">Model Roles</h4>
		<p class="text-xs text-gray-500">Assign a model to each role. Each role can optionally use an independent provider.</p>
	</div>

	<!-- Recommended Presets -->
	{#if availablePresets.length > 0}
		<div class="space-y-2">
			<span class="block text-xs font-medium text-gray-600">Recommended Presets</span>
			<div class="space-y-2">
				{#each availablePresets as preset (preset.id)}
					<button
						type="button"
						onclick={() => settings.applyPreset(preset)}
						class="w-full text-left border border-gray-200 rounded-lg p-3 hover:border-blue-400 hover:bg-blue-50 transition-colors group"
					>
						<div class="text-sm font-medium text-gray-900 group-hover:text-blue-700">{preset.name}</div>
						<div class="text-xs text-gray-500 mt-0.5">{preset.description}</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	{#each MODEL_ROLES as { role, label, description } (role)}
		{@const rc = settings.api.modelRoles[role]}
		<div class="border border-gray-200 rounded-lg p-4 space-y-3">
			<div>
				<span class="text-sm font-medium text-gray-900">{label}</span>
				<span class="text-xs text-gray-500 ml-1">— {description}</span>
			</div>

			{#if rc?.useCustomProvider}
				<!-- Independent provider fields -->
				<div class="space-y-2 pl-7">
					<div class="space-y-1">
						<label for="role-url-{role}" class="block text-xs font-medium text-gray-600">API URL</label>
						<input
							id="role-url-{role}"
							type="url"
							value={rc.customBaseUrl}
							oninput={(e) => handleRoleCustomBaseUrl(role, e.currentTarget.value)}
							placeholder="https://api.example.com/v1"
							class="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						/>
					</div>
					<div class="space-y-1">
						<label for="role-key-{role}" class="block text-xs font-medium text-gray-600">API Key</label>
						<input
							id="role-key-{role}"
							type="password"
							value={rc.customApiKey}
							oninput={(e) => handleRoleCustomApiKey(role, e.currentTarget.value)}
							placeholder="sk-..."
							class="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
						/>
					</div>
					<div class="space-y-1">
						<div class="flex items-center justify-between">
							<label for="role-model-{role}" class="block text-xs font-medium text-gray-600">Model</label>
							<button
								type="button"
								onclick={() => fetchRoleModels(role)}
								disabled={roleLoadingModels[role] || !rc.customApiKey || !rc.customBaseUrl}
								class="text-xs text-blue-600 hover:text-blue-700 disabled:text-gray-400 disabled:cursor-not-allowed"
							>
								{roleLoadingModels[role] ? 'Loading...' : 'Fetch Models'}
							</button>
						</div>
						<VirtualizedDropdown
							items={roleModels[role]}
							value={rc.model}
							placeholder={roleModels[role].length > 0 ? 'Select a model...' : 'Fetch models first'}
							searchPlaceholder="Search models..."
							noMatchText="No matching models"
							disabled={roleModels[role].length === 0}
							onchange={(model) => handleRoleModelSelect(role, model)}
						/>
						{#if roleModelsError[role]}
							<p class="text-xs text-red-500">{roleModelsError[role]}</p>
						{/if}
					</div>
				</div>
			{:else}
				<!-- Global provider model selector -->
				<div class="pl-7">
					<VirtualizedDropdown
						items={globalModels}
						value={rc?.model ?? ''}
						placeholder={globalModels.length > 0 ? 'Select a model...' : 'Fetch models first'}
						searchPlaceholder="Search models..."
						noMatchText="No matching models"
						disabled={globalModels.length === 0}
						onchange={(model) => handleRoleModelSelect(role, model)}
					/>
				</div>
			{/if}

			<!-- Independent provider toggle -->
			<div class="pl-7">
				<label class="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
					<input
						type="checkbox"
						checked={rc?.useCustomProvider ?? false}
						onchange={(e) => handleRoleCustomProviderToggle(role, e.currentTarget.checked)}
						class="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
					/>
					Use independent provider
				</label>
			</div>
		</div>
	{/each}

	<!-- Status summary -->
	<div class="mt-6 p-4 bg-gray-50 rounded-lg">
		<h4 class="text-sm font-medium text-gray-700 mb-2">Current Configuration</h4>
		<div class="space-y-1 text-sm text-gray-600">
			<div class="flex justify-between">
				<span>Provider:</span>
				<span class="font-medium">{API_PROVIDERS[provider].name}</span>
			</div>
			<div class="flex justify-between">
				<span>API Key:</span>
				<span class="font-medium">{apiKey ? '••••••••' + apiKey.slice(-4) : 'Not set'}</span>
			</div>
			{#each MODEL_ROLES as { role, label } (role)}
				{@const rc = settings.api.modelRoles[role]}
				<div class="flex justify-between">
					<span>{label}:</span>
					<span class="font-medium text-xs">
						{#if rc?.useCustomProvider}
							{rc.model || 'Not selected'} (custom)
						{:else}
							{rc?.model || 'Not selected'}
						{/if}
					</span>
				</div>
			{/each}
		</div>
	</div>
</div>
