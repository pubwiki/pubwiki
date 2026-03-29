<script lang="ts">
	/**
	 * InputNode - User input node type
	 * 
	 * Features:
	 * - Editable text content with @tag references for prompt composition
	 * - System tag handle (always visible, amber color)
	 * - Dynamic tag handles from @tag references in content
	 * - Generate button to trigger LLM generation
	 * - Conditional VFS footbar when connected to a VFS node
	 */
	import { useEdges, useUpdateNodeInternals, useSvelteFlow } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { InputNodeData, FlowNodeData, VFSNodeData } from '$lib/types';
	import { getStudioContext } from '$lib/state';
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import { nodeStore } from '$lib/persistence';
	import { validateNodeName } from '$lib/validation';
	import { vfsVersionStore, type VfsVersionState } from '$lib/vfs';
	import * as m from '$lib/paraglide/messages';
	import { 
		HandleId,
		createTagHandleId, 
		isTagHandle, 
		getTagName
	} from '$lib/graph';
	import { 
		getInputTagsFromBlocks, 
		getInputTagConnectionsFromSnapshotEdges
	} from '$lib/graph';
	import BaseNode from '../BaseNode.svelte';
	import { RefTagEditor } from '../../editor';
	import type { ContentBlock } from '../../editor';
	import TaggedHandlePanel, { type TaggedHandle, type HandleColorScheme } from '../TaggedHandlePanel.svelte';
	import { generate } from './controller.svelte';

	// ============================================================================
	// Props
	// ============================================================================

	let { isConnectable, selected, id }: NodeProps<Node<FlowNodeData, 'input'>> = $props();

	// ============================================================================
	// Context
	// ============================================================================

	const ctx = getStudioContext();
	const settings = getSettingsStore();
	const allEdges = useEdges();
	const updateNodeInternals = useUpdateNodeInternals();

	// ============================================================================
	// Node Data
	// ============================================================================

	const nodeData = $derived(nodeStore.get(id) as InputNodeData | undefined);

	// ============================================================================
	// Color Schemes
	// ============================================================================

	const SYSTEM_TAG_CONNECTED: HandleColorScheme = {
		bg: '#fef3c7',
		border: '#f59e0b',
		text: 'text-amber-700',
		handle: 'bg-amber-500'
	};

	const SYSTEM_TAG_DISCONNECTED: HandleColorScheme = {
		bg: '#fffbeb',
		border: '#fcd34d',
		text: 'text-amber-600',
		handle: 'bg-amber-400'
	};

	const PROMPT_TAG_CONNECTED: HandleColorScheme = {
		bg: '#eff6ff',
		border: '#93c5fd',
		text: 'text-blue-600',
		handle: 'bg-blue-500'
	};

	const PROMPT_TAG_DISCONNECTED: HandleColorScheme = {
		bg: '#ffffff',
		border: '#d1d5db',
		text: 'text-gray-500',
		handle: 'bg-gray-400'
	};

	const VFS_CONNECTED: HandleColorScheme = {
		bg: '#eef2ff',
		border: '#818cf8',
		text: 'text-indigo-600',
		handle: 'bg-indigo-500'
	};

	const VFS_DISCONNECTED: HandleColorScheme = {
		bg: '#f5f3ff',
		border: '#c7d2fe',
		text: 'text-indigo-500',
		handle: 'bg-indigo-400'
	};

	// ============================================================================
	// Derived
	// ============================================================================

	const previewState = $derived(ctx.getPreviewState(id));
	const isPreviewing = $derived(!!previewState?.content);
	
	// displayBlocks: in preview mode use historical content.blocks, otherwise use current content.blocks
	const displayBlocks = $derived<ContentBlock[]>(
		isPreviewing && previewState?.content && 'blocks' in previewState.content
			? (previewState.content.blocks as ContentBlock[])
			: nodeData?.content?.blocks ?? []
	);

	const contentTags = $derived(getInputTagsFromBlocks(nodeData?.content?.blocks ?? []));

	const systemConnection = $derived.by(() => {
		if (previewState?.incomingEdges) {
			const edge = previewState.incomingEdges.find(e => e.targetHandle === HandleId.SYSTEM_TAG);
			return edge?.source ?? null;
		}
		const edge = allEdges.current.find(e => e.target === id && e.targetHandle === HandleId.SYSTEM_TAG);
		return edge?.source ?? null;
	});

	const vfsConnection = $derived.by(() => {
		if (previewState?.incomingEdges) {
			const edge = previewState.incomingEdges.find(e => e.targetHandle === HandleId.VFS_INPUT);
			return edge?.source ?? null;
		}
		const edge = allEdges.current.find(e => e.target === id && e.targetHandle === HandleId.VFS_INPUT);
		return edge?.source ?? null;
	});

	const tagConnections = $derived.by(() => {
		if (previewState?.incomingEdges) {
			return getInputTagConnectionsFromSnapshotEdges(previewState.incomingEdges);
		}
		return new Map(
			allEdges.current
				.filter(e => e.target === id && isTagHandle(e.targetHandle))
				.map(e => [getTagName(e.targetHandle!), e.source])
		);
	});

	const systemHandle = $derived<TaggedHandle>({
		id: HandleId.SYSTEM_TAG,
		label: '@system',
		isConnected: systemConnection !== null,
		connectedColor: SYSTEM_TAG_CONNECTED,
		disconnectedColor: SYSTEM_TAG_DISCONNECTED
	});

	const vfsHandle = $derived<TaggedHandle>({
		id: HandleId.VFS_INPUT,
		label: 'files',
		isConnected: vfsConnection !== null,
		connectedColor: VFS_CONNECTED,
		disconnectedColor: VFS_DISCONNECTED
	});

	const tagHandles = $derived.by(() => {
		return contentTags.map((tagName): TaggedHandle => ({
			id: createTagHandleId(tagName),
			label: `@${tagName}`,
			isConnected: tagConnections.has(tagName),
			connectedColor: PROMPT_TAG_CONNECTED,
			disconnectedColor: PROMPT_TAG_DISCONNECTED
		}));
	});

	const allHandles = $derived([systemHandle, vfsHandle, ...tagHandles]);
	
	// VFS version state for footbar
	const vfsVersionState = $derived<VfsVersionState | undefined>(
		vfsConnection ? vfsVersionStore.get(vfsConnection) : undefined
	);
	const vfsHeadVersion = $derived(vfsVersionState?.headHash ?? null);
	const vfsHasPendingChanges = $derived(vfsVersionState?.hasPendingChanges ?? false);

	// ============================================================================
	// State
	// ============================================================================
	
	let versionStoreUnsubscribe: (() => void) | null = null;

	// ============================================================================
	// Effects
	// ============================================================================
	
	// Subscribe to VFS version store when connected
	$effect(() => {
		const vfsNodeId = vfsConnection;
		
		// Cleanup previous subscription
		if (versionStoreUnsubscribe) {
			versionStoreUnsubscribe();
			versionStoreUnsubscribe = null;
		}
		
		if (vfsNodeId) {
			const vfsData = nodeStore.get(vfsNodeId) as VFSNodeData | undefined;
			if (vfsData?.content?.projectId) {
				vfsVersionStore.subscribe(vfsData.content.projectId, vfsNodeId)
					.then(unsub => { versionStoreUnsubscribe = unsub; });
			}
		}
		
		return () => {
			versionStoreUnsubscribe?.();
			versionStoreUnsubscribe = null;
		};
	});

	$effect(() => {
		console.log('[InputNode] allHandles:', allHandles);
		console.log('[InputNode] vfsHandle:', vfsHandle);
		console.log('[InputNode] vfsConnection:', vfsConnection);
	});

	$effect(() => {
		void contentTags;
		updateNodeInternals(id);
	});

	// Clean up orphan edges when Tags are deleted
	$effect(() => {
		// Get current valid user Tag handle IDs
		const validUserTagHandleIds = new Set(
			contentTags.map(name => createTagHandleId(name))
		);
		
		// Find edges targeting this node's user Tag handles that no longer exist
		// Note: system-prompt handle is always valid (not a user tag), so we only check isTagHandle
		const orphanEdges = allEdges.current.filter(edge => 
			edge.target === id &&
			isTagHandle(edge.targetHandle) &&
			!validUserTagHandleIds.has(edge.targetHandle!)
		);
		
		// Delete orphan edges
		if (orphanEdges.length > 0) {
			const orphanEdgeIds = new Set(orphanEdges.map(e => e.id));
			ctx.updateEdges(edges => edges.filter(e => !orphanEdgeIds.has(e.id)));
		}
	});

	// ============================================================================
	// Event Handlers
	// ============================================================================
	
	// Node navigation
	const { fitView } = useSvelteFlow();
	
	function focusNode(nodeId: string) {
		fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.3 });
	}
	
	function getVfsNodeName(nodeId: string): string {
		const data = nodeStore.get(nodeId);
		return data?.name || 'VFS';
	}

	function handleFocus() {
		ctx.setEditingNodeId(id);
	}

	function handleBlur() {
		if (ctx.editingNodeId === id) {
			ctx.setEditingNodeId(null);
		}
	}

	function handleContentChange(newBlocks: ContentBlock[]) {
		ctx.updateNodeData(id, (data) => {
			const inputData = data as InputNodeData;
			return {
				...inputData,
				content: inputData.content.withBlocks(newBlocks)
			};
		});
	}

	async function handleGenerate() {
		const callbacks = {
			updateNodeData: ctx.updateNodeData,
			updateNodes: ctx.updateNodes,
			updateEdges: ctx.updateEdges,
		};
		const narrativeConfig = settings.getLLMConfigForRole('narrative');
		await generate(id, ctx.nodes, ctx.edges, {
			api: { apiKey: narrativeConfig.apiKey, model: narrativeConfig.model },
			effectiveBaseUrl: narrativeConfig.baseUrl,
		}, callbacks);
	}

	// Node name validation callback for BaseNode
	function handleValidateName(name: string, nodeId: string): string | null {
		return validateNodeName(name, nodeId);
	}
</script>

<BaseNode
	{id}
	{selected}
	{isConnectable}
	nodeType="INPUT"
	headerBgClass="bg-purple-500"
	handleBgClass="bg-purple-400!"
	showLeftHandle={false}
	validateName={handleValidateName}
>
	{#snippet leftHandles()}
		<TaggedHandlePanel
			handles={allHandles}
			{isConnectable}
			handleType="target"
			position="left"
			nodeOverlap={24}
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if !isPreviewing}
			<button
				class="nodrag px-2 py-0.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded text-white transition-colors flex items-center gap-1"
				onclick={handleGenerate}
				title={m.studio_node_generate_from_input()}
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
				</svg>
				{m.studio_properties_generate()}
			</button>
		{/if}
	{/snippet}

		<RefTagEditor
			value={displayBlocks}
			readonly={isPreviewing}
			placeholder={m.studio_node_input_placeholder()}
			class={isPreviewing ? 'bg-amber-50/30' : ''}
			onchange={handleContentChange}
			onfocus={handleFocus}
			onblur={handleBlur}
		/>
		
		<!-- VFS Connection Footbar (conditional) -->
		{#if vfsConnection}
			<div class="border-t border-gray-200 bg-gray-50 text-xs text-gray-500">
				<div class="px-3 py-1.5 flex items-center gap-2">
					<!-- Folder icon -->
					<svg class="w-3 h-3 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
					</svg>
					<button 
						class="text-indigo-600 hover:underline font-medium"
						onclick={() => focusNode(vfsConnection!)}
					>
						{getVfsNodeName(vfsConnection)}
					</button>
					<span class="text-gray-400">@</span>
					<span class="font-mono">
						{#if vfsHasPendingChanges}
							<span class="text-amber-600">current (pending)</span>
						{:else if vfsHeadVersion}
							{vfsHeadVersion.slice(0, 7)}
						{:else}
							<span class="text-gray-400">(empty)</span>
						{/if}
					</span>
				</div>
			</div>
		{/if}
</BaseNode>
