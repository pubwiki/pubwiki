<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow, type Node, type Edge, Position, SelectionMode } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import GraphNode from './GraphNode.svelte';
	import FlowController from './FlowController.svelte';
	
	import { ChatUI } from '@pubwiki/svelte-chat';
	import { PubChat, MemoryMessageStore } from '@pubwiki/chat';

	// Initialize Chat
	// Note: In a real app, you might want to persist this or load config from somewhere
	const pubchat = new PubChat({
		llm: {
            // FIXME: only for test, do not bring to production
			apiKey: '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', // Placeholder - user will likely need to configure this
			model: 'google/gemini-2.5-flash',
            baseUrl: 'https://openrouter.ai/api/v1'
		},
		messageStore: new MemoryMessageStore(),
	});

	const nodeTypes = {
		prompt: GraphNode
	};

	// Textarea registry for external focus control
	const textareaRegistry = new Map<string, HTMLTextAreaElement>();
	
	function registerTextarea(id: string, el: HTMLTextAreaElement) {
		textareaRegistry.set(id, el);
	}
	
	function unregisterTextarea(id: string) {
		textareaRegistry.delete(id);
	}
	
	function focusNode(id: string) {
		const textarea = textareaRegistry.get(id);
		if (textarea) {
			textarea.focus();
		}
	}

	// Shared callbacks for node editing state - declared before nodes initialization
	function onEditStart(id: string) {
		editingNodeId = id;
		nodes = nodes.map(n => ({
			...n,
			data: {
				...n.data,
				isEditing: n.id === id
			}
		}));
	}
	
	function onEditEnd(id: string) {
		if (editingNodeId === id) {
			editingNodeId = null;
			nodes = nodes.map(n => ({
				...n,
				data: {
					...n.data,
					isEditing: false
				}
			}));
		}
	}

	// Flow State - use $state.raw for xyflow compatibility
	let nodes = $state.raw<Node[]>([
		{
			id: '1',
			type: 'prompt',
			data: { type: 'PROMPT', content: '', onEditStart, onEditEnd, registerTextarea, unregisterTextarea },
			position: { x: 250, y: 25 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		},
	]);
	
	let edges = $state.raw<Edge[]>([]);
	let editingNodeId = $state<string | null>(null);
	let selectedNodes = $state<Node[]>([]);
	let flowApi = $state<ReturnType<typeof useSvelteFlow> | null>(null);

	function addNode() {
		const newNode: Node = {
			id: crypto.randomUUID(),
			type: 'prompt',
			data: { type: 'PROMPT', content: '', onEditStart, onEditEnd, registerTextarea, unregisterTextarea },
			position: { x: Math.random() * 500, y: Math.random() * 500 },
			sourcePosition: Position.Right,
			targetPosition: Position.Left,
		};
		nodes = [...nodes, newNode];
	}

	function handleBadgeClick(node: Node) {
		// Center the view on the node first
		if (flowApi) {
			flowApi.fitView({ nodes: [{ id: node.id }], duration: 400, padding: 0.2 });
		}
		// Focus the textarea after a short delay to allow view animation
		setTimeout(() => {
			focusNode(node.id);
		}, 100);
	}
</script>

<div class="h-screen w-full relative flex">
	<!-- Flow Editor -->
	<div class="flex-1 h-full relative">
		<SvelteFlow 
			bind:nodes 
			bind:edges 
			{nodeTypes} 
			fitView
			selectionOnDrag
			selectionMode={SelectionMode.Partial}
			panOnDrag={[1, 2]}
			panOnScroll
			multiSelectionKey="Shift"
			onselectionchange={(e) => selectedNodes = e.nodes}
		>
			<FlowController onInit={(flow) => flowApi = flow} />
			<Background />
			<Controls />
		</SvelteFlow>
		
		<!-- Toolbar -->
		<div class="absolute top-4 left-4 z-10 bg-white p-2 rounded shadow flex gap-2">
			<button 
				class="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 transition text-sm font-medium"
				onclick={addNode}
			>
				Add Node
			</button>
		</div>
	</div>

	<!-- Floating Chat -->
	<div class="w-96 h-full border-l border-gray-200 bg-white flex flex-col shadow-xl z-20">
		<div class="p-4 border-b border-gray-200 font-bold bg-gray-50 flex justify-between items-center">
			<span>AI Assistant</span>
			<span class="text-xs text-gray-500 bg-gray-200 px-2 py-1 rounded">GPT-4</span>
		</div>
		
		<!-- Selected Nodes Badges -->
		{#if selectedNodes.length > 0}
			<div class="px-4 py-2 bg-white border-b border-gray-100 flex flex-wrap gap-2 min-h-12 items-center">
				{#each selectedNodes as node (node.id)}
					<button 
						class="px-2 py-1 rounded-full text-xs font-medium border transition-all flex items-center gap-1
						{editingNodeId === node.id 
							? 'bg-blue-100 text-blue-700 border-blue-200 ring-1 ring-blue-300' 
							: 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'}"
						onclick={() => handleBadgeClick(node)}
					>
						<div class="w-1.5 h-1.5 rounded-full {editingNodeId === node.id ? 'bg-green-400' : 'bg-gray-400'}"></div>
						{node.data.type || 'NODE'}
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex-1 overflow-hidden relative">
			<ChatUI {pubchat} />
		</div>
	</div>
</div>

<style>
	:global(.svelte-flow__selection-wrapper) {
		display: none;
	}
</style>

