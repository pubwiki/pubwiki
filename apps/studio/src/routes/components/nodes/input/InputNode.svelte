<script lang="ts">
	/**
	 * InputNode - User input node type
	 * 
	 * Features:
	 * - Editable text content with @tag references for prompt composition
	 * - System tag handle (always visible, amber color)
	 * - Dynamic tag handles from @tag references in content
	 * - Mountpoint handles from data.mountpoints array
	 * - "Add Mount" handle for creating new mountpoints via drag connection
	 * - Generate button to trigger LLM generation
	 */
	import { useEdges, useUpdateNodeInternals } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { InputNodeData, FlowNodeData } from '../../../types';
	import { getStudioContext } from '../../../state';
	import { getSettingsStore } from '@pubwiki/ui/stores';
	import { nodeStore } from '../../../persistence';
	import * as m from '$lib/paraglide/messages';
	import { 
		HandleId,
		createTagHandleId, 
		createMountpointHandleId, 
		isTagHandle, 
		isMountpointHandle, 
		getTagName, 
		getMountpointId 
	} from '../../../graph';
	import { 
		getInputTagsFromBlocks, 
		getInputTagConnectionsFromSnapshotEdges, 
		getMountpointConnectionsFromSnapshotEdges 
	} from '../../../graph';
	import BaseNode from '../BaseNode.svelte';
	import { RefTagEditor } from '../../editor';
	import type { ContentBlock } from '../../editor';
	import TaggedHandlePanel, { type TaggedHandle, type HandleColorScheme } from '../TaggedHandlePanel.svelte';
	import { 
		getEditingMountpoint, 
		setEditingMountpoint, 
		updateMountpointPath,
		validateMountpointPath,
		generate
	} from './controller.svelte';

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

	const MOUNT_TAG_CONNECTED: HandleColorScheme = {
		bg: '#eef2ff',
		border: '#a5b4fc',
		text: 'text-indigo-600',
		handle: 'bg-indigo-500'
	};

	const MOUNT_TAG_DISCONNECTED: HandleColorScheme = {
		bg: '#f5f3ff',
		border: '#c7d2fe',
		text: 'text-indigo-400',
		handle: 'bg-indigo-300'
	};

	const ADD_MOUNT_COLOR: HandleColorScheme = {
		bg: '#e0e7ff',
		border: '#a5b4fc',
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

	const mountpointConnections = $derived.by(() => {
		if (previewState?.incomingEdges) {
			return getMountpointConnectionsFromSnapshotEdges(previewState.incomingEdges);
		}
		// Map from mountpoint ID to source node ID
		return new Map(
			allEdges.current
				.filter(e => e.target === id && isMountpointHandle(e.targetHandle))
				.map(e => [getMountpointId(e.targetHandle!), e.source])
		);
	});

	const systemHandle = $derived<TaggedHandle>({
		id: HandleId.SYSTEM_TAG,
		label: '@system',
		isConnected: tagConnections.has('system'),
		connectedColor: SYSTEM_TAG_CONNECTED,
		disconnectedColor: SYSTEM_TAG_DISCONNECTED
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

	/** Check if we're editing a mountpoint on this node (from controller state) */
	const editingMountpointId = $derived.by(() => {
		const editing = getEditingMountpoint();
		return editing?.nodeId === id ? editing.mountpointId : null;
	});

	const mountpointHandles = $derived.by(() => {
		const mounts = nodeData?.content?.mountpoints ?? [];
		return mounts.map((mp): TaggedHandle => ({
			id: createMountpointHandleId(mp.id),
			label: mp.path,
			isConnected: mountpointConnections.has(mp.id),
			connectedColor: MOUNT_TAG_CONNECTED,
			disconnectedColor: MOUNT_TAG_DISCONNECTED,
			isEditing: mp.id === editingMountpointId,
			editable: true,
			// Store the mountpoint ID for editing operations
			data: { mountpointId: mp.id }
		}));
	});

	const allHandles = $derived([systemHandle, ...tagHandles, ...mountpointHandles]);

	const connectedMountCount = $derived(
		Array.from(mountpointConnections.values()).length
	);

	// ============================================================================
	// Effects
	// ============================================================================

	$effect(() => {
		contentTags;
		nodeData?.content?.mountpoints;
		updateNodeInternals(id);
	});

	// Clean up orphan edges when Tags are deleted
	$effect(() => {
		// Get current valid Tag handle IDs (system tag is always valid)
		const validTagHandleIds = new Set([
			HandleId.SYSTEM_TAG,
			...contentTags.map(name => createTagHandleId(name))
		]);
		
		// Find edges targeting this node's Tag handles that no longer exist
		const orphanEdges = allEdges.current.filter(edge => 
			edge.target === id &&
			isTagHandle(edge.targetHandle) &&
			!validTagHandleIds.has(edge.targetHandle!)
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
		await generate(id, ctx.nodes, ctx.edges, settings, callbacks);
	}

	function handleMountpointLabelChange(handleId: string, _oldLabel: string, newLabel: string, handleData?: Record<string, unknown>) {
		let validPath = newLabel.trim();
		if (!validPath.startsWith('/')) {
			validPath = '/' + validPath;
		}
		
		// Get the mountpoint ID from handle data
		const mountpointId = handleData?.mountpointId as string | undefined;
		if (!mountpointId) {
			console.warn('Missing mountpointId in handle data');
			return;
		}
		
		// updateMountpointPath now uses nodeStore directly
		updateMountpointPath(
			id,
			mountpointId,
			validPath
		);
	}

	function handleMountpointEditComplete(_handleId: string) {
		setEditingMountpoint(null);
	}
	
	function handleMountpointValidation(_handleId: string, label: string, handleData?: Record<string, unknown>): string | null {
		const existingMountpoints = nodeData?.content?.mountpoints ?? [];
		// Get the mountpoint ID being edited from handle data
		const currentMountpointId = handleData?.mountpointId as string | undefined;
		return validateMountpointPath(label, existingMountpoints, currentMountpointId);
	}

	function handleMountpointStartEdit(_handleId: string, handleData?: Record<string, unknown>) {
		const mountpointId = handleData?.mountpointId as string | undefined;
		if (mountpointId) {
			setEditingMountpoint({ nodeId: id, mountpointId });
		}
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
>
	{#snippet leftHandles()}
		<TaggedHandlePanel
			handles={allHandles}
			{isConnectable}
			handleType="target"
			position="left"
			nodeOverlap={24}
			addHandle={{
				id: HandleId.ADD_MOUNT,
				label: 'mount',
				color: ADD_MOUNT_COLOR
			}}
			onLabelChange={handleMountpointLabelChange}
			onEditComplete={handleMountpointEditComplete}
			validateLabel={handleMountpointValidation}
			onStartEdit={handleMountpointStartEdit}
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if !isPreviewing}
			{#if connectedMountCount > 0}
				<span class="text-xs text-indigo-200 flex items-center gap-0.5">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
					</svg>
					{connectedMountCount} mount{connectedMountCount > 1 ? 's' : ''}
				</span>
			{/if}
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

	{#snippet children()}
		<RefTagEditor
			value={displayBlocks}
			readonly={isPreviewing}
			placeholder={m.studio_node_input_placeholder()}
			class={isPreviewing ? 'bg-amber-50/30' : ''}
			onchange={handleContentChange}
			onfocus={handleFocus}
			onblur={handleBlur}
		/>
	{/snippet}
</BaseNode>
