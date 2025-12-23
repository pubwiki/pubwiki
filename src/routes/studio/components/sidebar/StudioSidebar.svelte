<script lang="ts">
	/**
	 * StudioSidebar - Left side collapsible floating panel
	 * 
	 * Features:
	 * - Collapsible to a project name badge at the top
	 * - Three tabs: Overview, Properties, Project
	 * - Float above the flow editor
	 */
	import type { Node, Edge } from '@xyflow/svelte';
	import type { StudioNodeData } from '../../utils/types';
	import type { PublishMetadata } from '../../utils/publish';
	import OverviewTab from './OverviewTab.svelte';
	import PropertiesTab from './PropertiesTab.svelte';
	import ProjectTab from './ProjectTab.svelte';

	interface Props {
		nodes: Node<StudioNodeData>[];
		edges: Edge[];
		selectedNodes: Node<StudioNodeData>[];
		projectId: string;
		projectName: string;
		isDraft: boolean;
		isAuthenticated: boolean;
		onFocusNode: (node: Node<StudioNodeData>) => void;
		onPublish: (metadata: PublishMetadata, nodes: Node<StudioNodeData>[], edges: Edge[]) => Promise<void>;
	}

	let { 
		nodes, 
		edges, 
		selectedNodes, 
		projectId, 
		projectName,
		isDraft,
		isAuthenticated,
		onFocusNode,
		onPublish
	}: Props = $props();

	// Sidebar state
	let collapsed = $state(false);
	let activeTab = $state<'overview' | 'properties' | 'project'>('overview');
	let sidebarEl: HTMLDivElement | undefined = $state();

	// Auto-switch to properties tab when selecting a single node
	$effect(() => {
		if (selectedNodes.length === 1) {
			activeTab = 'properties';
		}
	});

	function toggle() {
		collapsed = !collapsed;
	}

	const tabs = [
		{ id: 'overview' as const, label: 'Overview', icon: 'grid' },
		{ id: 'properties' as const, label: 'Properties', icon: 'settings' },
		{ id: 'project' as const, label: 'Project', icon: 'folder' }
	];
</script>

<!-- Collapsed Badge (shown at top when collapsed) -->
{#if collapsed}
	<button
		class="absolute top-4 left-4 z-30 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-md hover:shadow-lg transition-all flex items-center gap-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
		onclick={toggle}
		title="Expand panel"
	>
		<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
		</svg>
		<span class="max-w-32 truncate">{projectName || 'Untitled Project'}</span>
		<svg class="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
		</svg>
	</button>
{/if}

<!-- Expanded Sidebar Panel -->
{#if !collapsed}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div 
		bind:this={sidebarEl}
		class="absolute top-4 left-4 bottom-4 z-20 w-80 bg-white border border-gray-200 rounded-xl shadow-xl flex flex-col overflow-hidden"
		onpointerdown={(e) => {
			e.stopPropagation();
			// Only capture pointer for text selection (in textarea/input or text content)
			const target = e.target as HTMLElement;
			const isTextInput = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;
			const isTextSelection = target.closest('.prose, .properties-textarea, [contenteditable]');
			if (sidebarEl && (isTextInput || isTextSelection)) {
				sidebarEl.setPointerCapture(e.pointerId);
			}
		}}
		onpointerup={(e) => {
			e.stopPropagation();
			if (sidebarEl && sidebarEl.hasPointerCapture(e.pointerId)) {
				sidebarEl.releasePointerCapture(e.pointerId);
			}
		}}
	>
		<!-- Header with project name and collapse button -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
			<div class="flex items-center gap-2 min-w-0">
				<svg class="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
				</svg>
				<span class="font-medium text-gray-700 truncate">{projectName || 'Untitled Project'}</span>
				{#if !isDraft}
					<span class="px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 rounded">Published</span>
				{/if}
			</div>
			<button
				class="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
				onclick={toggle}
				title="Collapse panel"
			>
				<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
				</svg>
			</button>
		</div>

		<!-- Tab Navigation -->
		<div class="flex border-b border-gray-200 bg-white">
			{#each tabs as tab}
				<button
					class="flex-1 px-3 py-2.5 text-sm font-medium transition-colors relative
						{activeTab === tab.id 
							? 'text-blue-600' 
							: 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}"
					onclick={() => activeTab = tab.id}
				>
					{tab.label}
					{#if activeTab === tab.id}
						<div class="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-600"></div>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Tab Content -->
		<div class="flex-1 overflow-hidden">
			{#if activeTab === 'overview'}
				<OverviewTab {nodes} {edges} {onFocusNode} />
			{:else if activeTab === 'properties'}
				<PropertiesTab {selectedNodes} />
			{:else if activeTab === 'project'}
				<ProjectTab 
					{nodes} 
					{edges} 
					{projectId}
					{projectName}
					{isDraft}
					{isAuthenticated}
					{onPublish}
				/>
			{/if}
		</div>
	</div>
{/if}
