<script lang="ts">
	/**
	 * OverviewTab - Shows all nodes in the workspace grouped by type
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { StudioNodeData } from '../../types';
	import * as m from '$lib/paraglide/messages';

	interface Props {
		nodes: Node<StudioNodeData>[];
		edges: Edge[];
		onFocusNode: (node: Node<StudioNodeData>) => void;
	}

	let { nodes, edges, onFocusNode }: Props = $props();

	// Group nodes by type
	let nodesByType = $derived.by(() => {
		const groups: Record<string, Node<StudioNodeData>[]> = {
			PROMPT: [],
			INPUT: [],
			GENERATED: [],
			VFS: [],
			SANDBOX: [],
			LOADER: [],
			STATE: []
		};
		
		for (const node of nodes) {
			const type = node.data.type;
			if (type in groups) {
				groups[type].push(node);
			}
		}
		
		return groups;
	});

	// Count of each type (only non-empty)
	let nonEmptyTypes = $derived(
		Object.entries(nodesByType).filter(([_, nodes]) => nodes.length > 0)
	);

	// Get display info for each node type
	function getTypeInfo(type: string) {
		switch (type) {
			case 'PROMPT':
				return { label: m.studio_overview_prompts(), color: 'blue', icon: 'document' };
			case 'INPUT':
				return { label: m.studio_overview_inputs(), color: 'purple', icon: 'chat' };
			case 'GENERATED':
				return { label: m.studio_overview_generated(), color: 'green', icon: 'spark' };
			case 'VFS':
				return { label: m.studio_overview_files(), color: 'indigo', icon: 'folder' };
			case 'SANDBOX':
				return { label: m.studio_overview_sandboxes(), color: 'orange', icon: 'monitor' };
			case 'LOADER':
				return { label: m.studio_overview_loaders(), color: 'purple', icon: 'database' };
			case 'STATE':
				return { label: m.studio_overview_states(), color: 'teal', icon: 'cube' };
			default:
				return { label: type, color: 'gray', icon: 'cube' };
		}
	}

	function getNodeDisplayName(node: Node<StudioNodeData>): string {
		return node.data.name || node.id.slice(0, 8);
	}

	function getNodePreview(node: Node<StudioNodeData>): string {
		// Use polymorphic getText() method
		const content = node.data.content.getText();
		if (content) {
			return content.slice(0, 60) + (content.length > 60 ? '...' : '');
		}
		return '';
	}

	function getColorClasses(color: string) {
		const colors: Record<string, { bg: string; text: string; border: string; light: string }> = {
			blue: { bg: 'bg-blue-500', text: 'text-blue-600', border: 'border-blue-200', light: 'bg-blue-50' },
			purple: { bg: 'bg-purple-500', text: 'text-purple-600', border: 'border-purple-200', light: 'bg-purple-50' },
			green: { bg: 'bg-green-500', text: 'text-green-600', border: 'border-green-200', light: 'bg-green-50' },
			indigo: { bg: 'bg-indigo-500', text: 'text-indigo-600', border: 'border-indigo-200', light: 'bg-indigo-50' },
			orange: { bg: 'bg-orange-500', text: 'text-orange-600', border: 'border-orange-200', light: 'bg-orange-50' },
			teal: { bg: 'bg-teal-500', text: 'text-teal-600', border: 'border-teal-200', light: 'bg-teal-50' },
			gray: { bg: 'bg-gray-500', text: 'text-gray-600', border: 'border-gray-200', light: 'bg-gray-50' }
		};
		return colors[color] || colors.gray;
	}
</script>

<div class="h-full overflow-y-auto p-4 space-y-4">
	{#if nonEmptyTypes.length === 0}
		<div class="flex flex-col items-center justify-center h-full text-gray-400">
			<svg class="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
			</svg>
			<p class="text-sm">{m.studio_overview_no_nodes()}</p>
			<p class="text-xs text-gray-300 mt-1">{m.studio_overview_add_hint()}</p>
		</div>
	{:else}
		<!-- Stats Summary -->
		<div class="flex flex-wrap gap-2">
			{#each nonEmptyTypes as [type, typeNodes]}
				{@const info = getTypeInfo(type)}
				{@const colors = getColorClasses(info.color)}
				<div class="flex items-center gap-1.5 px-2 py-1 {colors.light} rounded-full">
					<div class="w-2 h-2 rounded-full {colors.bg}"></div>
					<span class="text-xs font-medium {colors.text}">{typeNodes.length}</span>
					<span class="text-xs text-gray-500">{info.label}</span>
				</div>
			{/each}
		</div>

		<!-- Node Groups -->
		{#each nonEmptyTypes as [type, typeNodes]}
			{@const info = getTypeInfo(type)}
			{@const colors = getColorClasses(info.color)}
			<div class="space-y-2">
				<div class="flex items-center gap-2">
					<div class="w-1 h-4 rounded-full {colors.bg}"></div>
					<h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wide">{info.label}</h3>
					<span class="text-xs text-gray-400">({typeNodes.length})</span>
				</div>
				
				<div class="space-y-1.5">
					{#each typeNodes as node (node.id)}
						<button
							class="w-full text-left px-3 py-2 rounded-lg border {colors.border} hover:bg-gray-50 transition-colors group"
							onclick={() => onFocusNode(node)}
						>
							<div class="flex items-center gap-2">
								<div class="w-2 h-2 rounded-full {colors.bg} shrink-0"></div>
								<span class="font-medium text-sm text-gray-700 truncate group-hover:{colors.text}">
									{getNodeDisplayName(node)}
								</span>
							</div>
							{#if getNodePreview(node)}
								<p class="mt-1 text-xs text-gray-400 truncate pl-4">
									{getNodePreview(node)}
								</p>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
