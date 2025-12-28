<script lang="ts">
	/**
	 * PropertiesTab - Shows details and editor for the selected node
	 */
	import type { Node } from '@xyflow/svelte';
	import type { StudioNodeData, PromptNodeData, InputNodeData, GeneratedNodeData } from '../../types';
	import { getStudioContext } from '../../state';
	import { getSettingsStore } from '$lib/stores/settings.svelte';
	import { marked } from 'marked';
	import RichTextArea from '../RichTextArea.svelte';
	import { generate } from '../nodes/input/controller.svelte';
	import { regenerate } from '../nodes/generated/controller.svelte';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		selectedNodes: Node<StudioNodeData>[];
	}

	let { selectedNodes }: Props = $props();

	const ctx = getStudioContext();
	const settings = getSettingsStore();

	// Single selected node
	let selectedNode = $derived(selectedNodes.length === 1 ? selectedNodes[0] : null);

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
			gray: { bg: 'bg-gray-500', text: 'text-gray-600', light: 'bg-gray-50' }
		};
		return colors[color] || colors.gray;
	}

	// Content change handler for editable nodes
	function handleContentChange(newValue: string) {
		if (!selectedNode) return;
		ctx.updateNode(selectedNode.id, (nodeData) => {
			if (nodeData.type === 'INPUT') {
				const inputData = nodeData as InputNodeData;
				return { ...inputData, content: inputData.content.withText(newValue) };
			} else if (nodeData.type === 'PROMPT') {
				const promptData = nodeData as PromptNodeData;
				return { ...promptData, content: promptData.content.withText(newValue) };
			}
			return nodeData;
		});
	}

	// Name change handler
	function handleNameChange(e: Event) {
		if (!selectedNode) return;
		const target = e.target as HTMLInputElement;
		ctx.updateNode(selectedNode.id, (nodeData) => ({
			...nodeData,
			name: target.value
		}));
	}

	// Generation handlers
	async function handleGenerate() {
		if (!selectedNode) return;
		const callbacks = {
			updateNodes: ctx.updateNodes,
			updateEdges: ctx.updateEdges,
		};
		const config = {
			apiKey: settings.api.apiKey,
			model: settings.api.selectedModel,
			baseUrl: settings.effectiveBaseUrl
		};
		await generate(config, selectedNode.id, ctx.nodes, ctx.edges, callbacks);
	}

	async function handleRegenerate() {
		if (!selectedNode) return;
		const callbacks = {
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

	// Check if node is editable
	const isEditable = $derived(
		selectedNode && (selectedNode.data.type === 'PROMPT' || selectedNode.data.type === 'INPUT')
	);

	// Get display content (uses polymorphic getText() method)
	const displayContent = $derived.by(() => {
		if (!selectedNode) return '';
		return selectedNode.data.content.getText();
	});
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
						value={selectedNode.data.name || ''}
						oninput={handleNameChange}
						placeholder={m.studio_properties_untitled()}
						class="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
					/>
				</div>

				<!-- Type description -->
				<p class="text-xs text-gray-400">{info.description}</p>
			</div>

			<!-- Content area -->
			<div class="p-4">
				<div class="flex items-center justify-between mb-2">
					<span class="text-xs font-medium text-gray-500">{m.studio_properties_content()}</span>
					
					<!-- Action buttons based on type -->
					{#if selectedNode.data.type === 'INPUT'}
						<button
							class="px-2 py-1 text-xs font-medium bg-purple-500 hover:bg-purple-600 text-white rounded transition-colors flex items-center gap-1"
							onclick={handleGenerate}
						>
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
							</svg>
							{m.studio_properties_generate()}
						</button>
					{:else if selectedNode.data.type === 'GENERATED'}
						<button
							class="px-2 py-1 text-xs font-medium bg-green-500 hover:bg-green-600 text-white rounded transition-colors flex items-center gap-1"
							onclick={handleRegenerate}
						>
							<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
							</svg>
							{m.studio_properties_regenerate()}
						</button>
					{/if}
				</div>

				<!-- Content editor/viewer -->
				<div class="rounded-lg border border-gray-200 min-h-48">
					{#if isEditable}
						<div class="properties-textarea">
							<RichTextArea
								value={displayContent}
								placeholder={m.studio_properties_enter_content()}
								onchange={handleContentChange}
							/>
						</div>
					{:else if selectedNode.data.type === 'GENERATED'}
						<!-- Markdown rendered content for generated nodes -->
						<div class="p-3 bg-green-50/30">
							<div class="prose prose-sm max-w-none text-left select-text">
								{@html marked.parse(displayContent || '')}
							</div>
						</div>
					{:else}
						<!-- Readonly display for other types -->
						<div class="p-3 bg-gray-50 text-sm text-gray-600">
							{#if displayContent}
								<pre class="whitespace-pre-wrap font-mono text-xs">{displayContent}</pre>
							{:else}
								<span class="text-gray-400 italic">{m.studio_properties_no_content()}</span>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Metadata footer (fixed at bottom) -->
		{#if selectedNode.data.commit}
			<div class="shrink-0 p-4 border-t border-gray-100 bg-gray-50">
				<div class="flex items-center gap-2 text-xs text-gray-400">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
					</svg>
					<span>Commit: {selectedNode.data.commit.slice(0, 8)}</span>
				</div>
			</div>
		{/if}
	{/if}
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
