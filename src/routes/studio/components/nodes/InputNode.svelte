<script lang="ts">
	/**
	 * InputNode - User input node type
	 * 
	 * Features:
	 * - Editable text content with @tag references for prompt composition
	 * - System tag handle (always visible, amber color)
	 * - Dynamic tag handles from @tag references in content
	 * - Mountpoint handles from data.mountpoints array (not text parsing)
	 * - "Add Mount" handle for creating new mountpoints via drag connection
	 * - Generate button to trigger LLM generation
	 */
	import { useEdges, useUpdateNodeInternals } from '@xyflow/svelte';
	import type { NodeProps, Node } from '@xyflow/svelte';
	import type { InputNodeData, SnapshotEdge } from '../../utils/types';
	import { getStudioContext } from '../../stores/context';
	import { 
		HandleId,
		createTagHandleId, 
		createMountpointHandleId, 
		isTagHandle, 
		isMountpointHandle, 
		getTagName, 
		getMountpointPath 
	} from '../../utils/connection';
	import { 
		getInputTags, 
		getInputTagConnectionsFromSnapshotEdges, 
		getMountpointConnectionsFromSnapshotEdges 
	} from '../../utils/reftag';
	import BaseNode from './BaseNode.svelte';
	import RichTextArea from '../RichTextArea.svelte';
	import TaggedHandlePanel, { type TaggedHandle, type HandleColorScheme, type AddHandleConfig } from './TaggedHandlePanel.svelte';

	// ============================================================================
	// Props
	// ============================================================================

	let { data, isConnectable, selected, id }: NodeProps<Node<InputNodeData, 'input'>> = $props();

	// ============================================================================
	// Context
	// ============================================================================

	const ctx = getStudioContext();
	const allEdges = useEdges();
	const updateNodeInternals = useUpdateNodeInternals();

	// ============================================================================
	// Color Schemes
	// ============================================================================

	// System tag - special amber color (always present)
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

	// Regular prompt tags - blue
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

	// Mountpoints - indigo
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

	// Add mount button - light indigo
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
	const displayContent = $derived(previewState?.content ?? data.content);

	/** Parse tags from content (excludes 'system' as it's handled separately) */
	const contentTags = $derived(getInputTags(data.content));

	/** Get tag connections from current edges or preview edges */
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

	/** Get mountpoint connections from current edges or preview edges */
	const mountpointConnections = $derived.by(() => {
		if (previewState?.incomingEdges) {
			return getMountpointConnectionsFromSnapshotEdges(previewState.incomingEdges);
		}
		return new Map(
			allEdges.current
				.filter(e => e.target === id && isMountpointHandle(e.targetHandle))
				.map(e => [getMountpointPath(e.targetHandle!), e.source])
		);
	});

	/** System handle - always present */
	const systemHandle = $derived<TaggedHandle>({
		id: HandleId.SYSTEM_TAG,
		label: '@system',
		isConnected: tagConnections.has('system'),
		connectedColor: SYSTEM_TAG_CONNECTED,
		disconnectedColor: SYSTEM_TAG_DISCONNECTED
	});

	/** Build tagged handles for prompt tags from content */
	const tagHandles = $derived.by(() => {
		return contentTags.map((tagName): TaggedHandle => ({
			id: createTagHandleId(tagName),
			label: `@${tagName}`,
			isConnected: tagConnections.has(tagName),
			connectedColor: PROMPT_TAG_CONNECTED,
			disconnectedColor: PROMPT_TAG_DISCONNECTED
		}));
	});

	/** Check if we're currently editing a mountpoint on this node */
	const editingMountpointPath = $derived(
		ctx.editingMountpoint?.nodeId === id ? ctx.editingMountpoint.path : null
	);

	/** Build tagged handles for mountpoints from data.mountpoints */
	const mountpointHandles = $derived.by(() => {
		const mounts = data.mountpoints ?? [];
		return mounts.map((path): TaggedHandle => ({
			id: createMountpointHandleId(path),
			label: path,
			isConnected: mountpointConnections.has(path),
			connectedColor: MOUNT_TAG_CONNECTED,
			disconnectedColor: MOUNT_TAG_DISCONNECTED,
			isEditing: path === editingMountpointPath
		}));
	});

	/** Combined handles for panel display: system first, then tags, then mounts */
	const allHandles = $derived([systemHandle, ...tagHandles, ...mountpointHandles]);

	/** Count of connected prompt nodes */
	const connectedPromptCount = $derived(
		Array.from(tagConnections.values()).length
	);

	/** Count of connected mountpoints */
	const connectedMountCount = $derived(
		Array.from(mountpointConnections.values()).length
	);

	// ============================================================================
	// Effects
	// ============================================================================

	$effect(() => {
		// Trigger update when tags/mountpoints change so handles are registered
		contentTags;
		data.mountpoints;
		updateNodeInternals(id);
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

	function handleContentChange(newValue: string) {
		ctx.updateNode(id, (nodeData) => ({
			...nodeData,
			content: newValue
		}));
	}

	function handleGenerate() {
		ctx.onGenerate(id);
	}

	function handleMountpointLabelChange(handleId: string, oldLabel: string, newLabel: string) {
		// Ensure the new path starts with /
		let validPath = newLabel.trim();
		if (!validPath.startsWith('/')) {
			validPath = '/' + validPath;
		}
		if (validPath !== oldLabel) {
			ctx.updateMountpointPath(id, oldLabel, validPath);
		}
	}

	function handleMountpointEditComplete(_handleId: string) {
		ctx.setEditingMountpoint(null);
	}
</script>

<BaseNode
	{id}
	{data}
	{selected}
	{isConnectable}
	nodeType="INPUT"
	headerBgClass="bg-purple-500"
	handleBgClass="bg-purple-400!"
	showLeftHandle={false}
>
	{#snippet leftHandles()}
		<!-- TaggedHandlePanel for system, prompt tags, and mountpoint handles -->
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
		/>
	{/snippet}

	{#snippet headerIcon()}
		<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
		</svg>
	{/snippet}

	{#snippet headerActions()}
		{#if !isPreviewing}
			{#if connectedPromptCount > 0}
				<span class="text-xs text-purple-200">{connectedPromptCount} prompt{connectedPromptCount > 1 ? 's' : ''}</span>
			{/if}
			{#if connectedMountCount > 0}
				<span class="text-xs text-indigo-200 flex items-center gap-0.5">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
					</svg>
					{connectedMountCount} mount{connectedMountCount > 1 ? 's' : ''}
				</span>
			{/if}
			<!-- Generate button -->
			<button
				class="nodrag px-2 py-0.5 text-xs font-medium bg-white/20 hover:bg-white/30 rounded text-white transition-colors flex items-center gap-1"
				onclick={handleGenerate}
				title="Generate from this input"
			>
				<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
				</svg>
				Generate
			</button>
		{/if}
	{/snippet}

	{#snippet children()}
		<RichTextArea
			value={displayContent}
			readonly={isPreviewing}
			placeholder="Enter your input. Use @tag for prompt references."
			class={isPreviewing ? 'bg-amber-50/30' : ''}
			onchange={handleContentChange}
			onfocus={handleFocus}
			onblur={handleBlur}
		/>
	{/snippet}
</BaseNode>
