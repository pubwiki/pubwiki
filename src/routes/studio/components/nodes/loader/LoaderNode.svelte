<script lang="ts">
	/**
	 * LoaderNode - Custom service provider node
	 * 
	 * Features:
	 * - Provides custom services to Sandbox nodes via output handle
	 * - Supports multiple service types (echo, counter, wikirag, etc.)
	 * - Service configuration via JSON editor
	 * - Uses BaseNode for consistent styling
	 */
	import { Handle, Position, type NodeProps, type Node } from '@xyflow/svelte';
	import { onMount } from 'svelte';
	import type { LoaderNodeData, LoaderServiceType } from '../../../utils/types';
	import { LOADER_SERVICE_TYPES } from '../../../utils/types';
	import { getStudioContext } from '../../../stores/context';
	import BaseNode from '../BaseNode.svelte';
	import * as m from '$lib/paraglide/messages';

	// ============================================================================
	// Props & Context
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<LoaderNodeData, 'loader'>> = $props();
	const ctx = getStudioContext();

	// ============================================================================
	// State
	// ============================================================================

	let isEditingConfig = $state(false);
	let configValue = $state('');
	let configError = $state<string | null>(null);

	// Initialize configValue from data
	$effect(() => {
		if (!isEditingConfig) {
			configValue = data.config;
		}
	});

	// ============================================================================
	// Derived
	// ============================================================================

	const serviceTypeDisplay = $derived(getServiceTypeDisplay(data.serviceType));
	const isConfigValid = $derived(validateConfig(configValue));

	// ============================================================================
	// Helpers
	// ============================================================================

	function getServiceTypeDisplay(serviceType: string): { name: string; description: string; icon: string } {
		switch (serviceType) {
			case 'echo':
				return {
					name: m.studio_loader_echo(),
					description: m.studio_loader_echo_desc(),
					icon: '📢'
				};
			case 'counter':
				return {
					name: m.studio_loader_counter(),
					description: m.studio_loader_counter_desc(),
					icon: '🔢'
				};
			case 'wikirag':
				return {
					name: m.studio_loader_wikirag(),
					description: m.studio_loader_wikirag_desc(),
					icon: '📚'
				};
			default:
				return {
					name: serviceType,
					description: m.studio_loader_custom(),
					icon: '⚙️'
				};
		}
	}

	function validateConfig(config: string): boolean {
		try {
			JSON.parse(config);
			configError = null;
			return true;
		} catch (e) {
			configError = e instanceof Error ? e.message : 'Invalid JSON';
			return false;
		}
	}

	// ============================================================================
	// Event Handlers
	// ============================================================================

	function handleServiceTypeChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		const newType = target.value as LoaderServiceType;
		ctx.updateNode(id, (nodeData) => ({
			...nodeData,
			serviceType: newType,
			// Reset config when changing service type
			config: '{}',
			isActive: false
		}));
		configValue = '{}';
	}

	function startEditConfig() {
		isEditingConfig = true;
		configValue = data.config;
	}

	function saveConfig() {
		if (!isConfigValid) return;
		
		ctx.updateNode(id, (nodeData) => ({
			...nodeData,
			config: configValue
		}));
		isEditingConfig = false;
	}

	function cancelEditConfig() {
		configValue = data.config;
		configError = null;
		isEditingConfig = false;
	}

	function handleConfigKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			cancelEditConfig();
		} else if (e.key === 'Enter' && e.ctrlKey) {
			saveConfig();
		}
	}
</script>

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="LOADER"
	headerBgClass="bg-purple-500"
	handleBgClass="bg-purple-400!"
	showLeftHandle={false}
	showRightHandle={true}
>
	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		<!-- No header actions for loader node -->
		<span></span>
	{/snippet}

	{#snippet children()}
		<div class="p-3 bg-gray-50 space-y-3">
			<!-- Service Type Selector -->
			<div>
				<label for="service-type-{id}" class="block text-xs font-medium text-gray-500 mb-1">{m.studio_loader_service_type()}</label>
				<select
					id="service-type-{id}"
					class="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500 nodrag"
					value={data.serviceType}
					onchange={handleServiceTypeChange}
				>
					{#each LOADER_SERVICE_TYPES as type}
						<option value={type}>{getServiceTypeDisplay(type).icon} {getServiceTypeDisplay(type).name}</option>
					{/each}
				</select>
			</div>

			<!-- Service Info -->
			<div class="flex items-start gap-3">
				<span class="text-2xl">{serviceTypeDisplay.icon}</span>
				<div class="flex-1">
					<p class="text-sm font-medium text-gray-700">{serviceTypeDisplay.name}</p>
					<p class="text-xs text-gray-500">{serviceTypeDisplay.description}</p>
				</div>
				{#if data.isActive}
					<span class="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded-full">{m.studio_loader_active()}</span>
				{:else if data.error}
					<span class="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">{m.studio_loader_error()}</span>
				{:else}
					<span class="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">{m.studio_loader_idle()}</span>
				{/if}
			</div>

			<!-- Config Section -->
			<div>
				<div class="flex items-center justify-between mb-1">
					<label for="config-{id}" class="text-xs font-medium text-gray-500">{m.studio_loader_configuration()}</label>
					{#if !isEditingConfig}
						<button
							class="text-xs text-purple-600 hover:text-purple-700 nodrag"
							onclick={startEditConfig}
						>
							{m.studio_loader_edit()}
						</button>
					{/if}
				</div>
				
				{#if isEditingConfig}
					<div class="space-y-2">
						<textarea
							id="config-{id}"
							class="w-full h-20 px-2 py-1.5 text-xs font-mono border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/20 nodrag {configError ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white focus:border-purple-500'}"
							bind:value={configValue}
							onkeydown={handleConfigKeydown}
							placeholder="{'{}'}"
						></textarea>
						{#if configError}
							<p class="text-xs text-red-500">{configError}</p>
						{/if}
						<div class="flex gap-2 justify-end">
							<button
								class="px-2 py-1 text-xs text-gray-600 hover:text-gray-700 nodrag"
								onclick={cancelEditConfig}
							>
								{m.studio_loader_cancel()}
							</button>
							<button
								class="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed nodrag"
								onclick={saveConfig}
								disabled={!isConfigValid}
							>
								{m.studio_loader_save()}
							</button>
						</div>
					</div>
				{:else}
					<div class="px-2 py-1.5 text-xs font-mono bg-gray-100 rounded-lg text-gray-600 overflow-x-auto">
						<pre class="whitespace-pre-wrap break-all">{data.config || '{}'}</pre>
					</div>
				{/if}
			</div>

			<!-- Error Display -->
			{#if data.error}
				<div class="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded-lg">
					<svg class="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
					</svg>
					<p class="text-xs text-red-700">{data.error}</p>
				</div>
			{/if}
		</div>
	{/snippet}
</BaseNode>

<style>
	/* Override xyflow default node wrapper styles */
	:global(.svelte-flow__node-loader) {
		background: transparent !important;
		border: none !important;
		padding: 0 !important;
		border-radius: 0 !important;
		width: auto !important;
		box-shadow: none !important;
		outline: none !important;
	}
	
	:global(.svelte-flow__node-loader.selected) {
		background: transparent !important;
		border: none !important;
		box-shadow: none !important;
		outline: none !important;
	}
</style>
