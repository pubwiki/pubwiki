<script lang="ts">
	/**
	 * PropertiesTab - Shows details and editor for the selected node
	 * Delegates to type-specific property components
	 */
	import type { Node } from '@xyflow/svelte';
	import type { FlowNodeData } from '$lib/types/flow';
	import type { PromptNodeData, InputNodeData, VFSNodeData, GeneratedNodeData, StateNodeData } from '$lib/types';
	import { nodeStore } from '$lib/persistence/node-store.svelte';
	import { getStudioContext } from '$lib/state';
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import { InputProperties, PromptProperties, GeneratedProperties, DefaultProperties, VFSProperties, StateProperties } from './properties';
	import { generate } from '../nodes/input/controller.svelte';
	import { regenerate } from '../nodes/generated/controller.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		selectedNodes: Node<FlowNodeData>[];
		onOpenVfsFile?: (nodeId: string, filePath: string) => void;
	}

	let { selectedNodes, onOpenVfsFile }: Props = $props();

	const ctx = getStudioContext();
	const settings = getSettingsStore();

	// Single selected node
	let selectedNode = $derived(selectedNodes.length === 1 ? selectedNodes[0] : null);
	
	// Get business data for selected node from nodeStore
	let selectedNodeData = $derived(selectedNode ? nodeStore.get(selectedNode.id) : null);

	// Node type info
	function getTypeInfo(type: string) {
		switch (type) {
			case 'PROMPT':
				return { label: m.studio_node_prompt(), color: 'blue', description: m.studio_properties_prompt_desc() };
			case 'INPUT':
				return { label: m.studio_node_input(), color: 'purple', description: m.studio_properties_input_desc() };
			case 'GENERATED':
				return { label: m.studio_properties_generated(), color: 'green', description: m.studio_properties_generated_desc() };
			case 'VFS':
				return { label: m.studio_overview_files(), color: 'indigo', description: m.studio_properties_vfs_desc() };
			case 'SANDBOX':
				return { label: m.studio_node_sandbox(), color: 'orange', description: m.studio_properties_sandbox_desc() };
			case 'LOADER':
				return { label: m.studio_node_loader(), color: 'purple', description: m.studio_properties_loader_desc() };
			case 'STATE':
				return { label: m.studio_node_state(), color: 'teal', description: m.studio_state_desc() };
			default:
				return { label: type, color: 'gray', description: m.studio_properties_unknown_desc() };
		}
	}

	function getColorClasses(color: string) {
		const colors: Record<string, { bg: string; text: string; light: string }> = {
			blue: { bg: 'bg-blue-500', text: 'text-blue-600', light: 'bg-blue-50' },
			purple: { bg: 'bg-purple-500', text: 'text-purple-600', light: 'bg-purple-50' },
			green: { bg: 'bg-green-500', text: 'text-green-600', light: 'bg-green-50' },
			indigo: { bg: 'bg-indigo-500', text: 'text-indigo-600', light: 'bg-indigo-50' },
			orange: { bg: 'bg-orange-500', text: 'text-orange-600', light: 'bg-orange-50' },
			teal: { bg: 'bg-teal-500', text: 'text-teal-600', light: 'bg-teal-50' },
			gray: { bg: 'bg-gray-500', text: 'text-gray-600', light: 'bg-gray-50' }
		};
		return colors[color] || colors.gray;
	}

	// Name change handler
	function handleNameChange(e: Event) {
		if (!selectedNode) return;
		const target = e.target as HTMLInputElement;
		nodeStore.update(selectedNode.id, (nodeData) => ({
			...nodeData,
			name: target.value
		}));
	}

	// Generation handlers
	async function handleGenerate() {
		if (!selectedNode || !selectedNodeData || selectedNodeData.type !== 'INPUT') return;
		
		const callbacks = {
			updateNodeData: (nodeId: string, updater: (data: any) => any) => {
				nodeStore.update(nodeId, updater);
			},
			updateNodes: ctx.updateNodes,
			updateEdges: ctx.updateEdges,
		};
		
		await generate(selectedNode.id, ctx.nodes, ctx.edges, settings, callbacks);
	}

	async function handleRegenerate() {
		if (!selectedNode) return;
		const callbacks = {
			updateNodeData: (nodeId: string, updater: (data: any) => any) => {
				nodeStore.update(nodeId, updater);
			},
			updateNodes: ctx.updateNodes,
			updateEdges: ctx.updateEdges,
		};
		const config = {
			apiKey: settings.api.apiKey,
			model: settings.api.selectedModel,
			baseUrl: settings.effectiveBaseUrl
		};
		await regenerate(config, selectedNode.id, ctx.nodes, ctx.edges, callbacks);
	}
</script>

<div class="h-full flex flex-col overflow-hidden">
	{#if !selectedNode}
		<!-- No selection state -->
		<div class="flex flex-col items-center justify-center h-full text-gray-400 p-4">
			<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
			</svg>
			<p class="text-sm">{m.studio_properties_no_selection()}</p>
			<p class="text-xs text-gray-300 mt-1">{m.studio_properties_select_hint()}</p>
		</div>
	{:else if selectedNodes.length > 1}
		<!-- Multiple selection state -->
		<div class="flex flex-col items-center justify-center h-full text-gray-400 p-4">
			<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
			</svg>
			<p class="text-sm">{m.studio_properties_multi_selected({ count: selectedNodes.length })}</p>
			<p class="text-xs text-gray-300 mt-1">{m.studio_properties_single_hint()}</p>
		</div>
	{:else}
		{@const info = getTypeInfo(selectedNode.data.type)}
		{@const colors = getColorClasses(info.color)}
		
		<!-- Scrollable content area -->
		<div class="flex-1 overflow-y-auto min-h-0">
			<!-- Node header -->
			<div class="p-4 border-b border-gray-100 space-y-3">
				<!-- Type badge -->
				<div class="flex items-center gap-2">
					<div class="px-2 py-1 rounded-full {colors.light} {colors.text} text-xs font-medium flex items-center gap-1.5">
						<div class="w-2 h-2 rounded-full {colors.bg}"></div>
						{info.label}
					</div>
					<span class="text-xs text-gray-400">{selectedNode.id.slice(0, 8)}</span>
				</div>
				
				<!-- Name input -->
				<div>
					<span class="block text-xs font-medium text-gray-500 mb-1">{m.studio_properties_name()}</span>
					<input
						type="text"
						value={selectedNodeData?.name || ''}
						oninput={handleNameChange}
						placeholder={m.studio_properties_untitled()}
						class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
				</div>

				<!-- Type description -->
				<p class="text-xs text-gray-400">{info.description}</p>
			</div>

			<!-- Content area - delegated to type-specific components -->
			<div class="p-4">
				{#if selectedNodeData?.type === 'VFS'}
					<VFSProperties
						nodeId={selectedNode.id}
						data={selectedNodeData as VFSNodeData}
						onOpenFile={(nodeId, filePath) => onOpenVfsFile?.(nodeId, filePath)}
					/>
				{:else if selectedNodeData?.type === 'INPUT'}
					<InputProperties
						nodeId={selectedNode.id}
						data={selectedNodeData as InputNodeData}
						onGenerate={handleGenerate}
					/>
				{:else if selectedNodeData?.type === 'PROMPT'}
					<PromptProperties
						nodeId={selectedNode.id}
						data={selectedNodeData as PromptNodeData}
					/>
				{:else if selectedNodeData?.type === 'GENERATED'}
					<GeneratedProperties
						nodeId={selectedNode.id}
						data={selectedNodeData as GeneratedNodeData}
						onRegenerate={handleRegenerate}
					/>
				{:else if selectedNodeData?.type === 'STATE'}
					<StateProperties
						nodeId={selectedNode.id}
						data={selectedNodeData as StateNodeData}
					/>
				{:else if selectedNodeData}
					<DefaultProperties
						nodeId={selectedNode.id}
						data={selectedNodeData}
					/>
				{/if}
			</div>
		</div>

		<!-- Metadata footer (fixed at bottom) -->
		{#if selectedNodeData?.commit}
			<div class="shrink-0 p-4 border-t border-gray-100 bg-gray-50">
				<div class="flex items-center gap-2 text-xs text-gray-400">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
					</svg>
					<span>Commit: {selectedNodeData.commit.slice(0, 8)}</span>
				</div>
			</div>
		{/if}
	{/if}
</div>
