/**
 * Simple Mode Bridge
 *
 * Automatically creates and maintains a minimal flow-graph when the user is
 * in "simple mode".  The graph consists of 5 nodes and 4 edges that wire
 * STATE, VFS (backend + frontend), LOADER, and SANDBOX together.
 *
 * Node identification relies on `metadata["simple-mode-role"]`.
 */

import { extractTar, extractTarGz, type TarEntry } from '@pubwiki/flow-core';
import { Position, type Node, type Edge } from '@xyflow/svelte';
import { nodeStore } from '$lib/persistence/node-store.svelte';
import { layoutStore } from '$lib/persistence/layout-store';
import { getEdges, saveEdges } from '$lib/persistence/db';
import { getNodeRDFStore, type TripleStore } from '$lib/rdf';
import { getNodeVfs } from '$lib/vfs/store';
import {
	createStateNodeData,
	createVFSNodeData,
	createLoaderNodeData,
	createSandboxNodeData,
	type StudioNodeData
} from '$lib/types/node-data';
import type { FlowNodeData } from '$lib/types/flow';
import type { NodeType } from '$lib/types/content';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const META_KEY = 'simple-mode-role';

const ROLES = {
	state: 'state',
	backendVfs: 'backend-vfs',
	frontendVfs: 'frontend-vfs',
	loader: 'loader',
	sandbox: 'sandbox'
} as const;

type RoleValue = (typeof ROLES)[keyof typeof ROLES];

/** Layout positions – a simple left-to-right arrangement. */
const LAYOUT: Record<RoleValue, { x: number; y: number }> = {
	state: { x: 0, y: 0 },
	'backend-vfs': { x: 0, y: 250 },
	loader: { x: 400, y: 125 },
	'frontend-vfs': { x: 400, y: 375 },
	sandbox: { x: 800, y: 250 }
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SimpleModeNodeIds {
	state: string;
	backendVfs: string;
	frontendVfs: string;
	loader: string;
	sandbox: string;
}

/**
 * Callbacks to update the SvelteFlow rendering layer in real-time.
 * Same shape as the ones already used by StudioContext / GraphMutation.
 */
export interface FlowCallbacks {
	updateNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void;
	updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
}

// ---------------------------------------------------------------------------
// SimpleModeBridge
// ---------------------------------------------------------------------------

export class SimpleModeBridge {
	private projectId: string;
	private flowCallbacks: FlowCallbacks;
	private nodeIds: SimpleModeNodeIds | null = null;

	constructor(projectId: string, flowCallbacks: FlowCallbacks) {
		this.projectId = projectId;
		this.flowCallbacks = flowCallbacks;
	}

	// -----------------------------------------------------------------------
	// Public API
	// -----------------------------------------------------------------------

	/**
	 * Ensure the simple-mode flow graph exists.  Idempotent — if nodes
	 * already exist (identified by metadata) they are reused.
	 *
	 * Returns the node ID mapping once the graph is ready.
	 */
	async ensureGraph(): Promise<SimpleModeNodeIds> {
		if (this.nodeIds) return this.nodeIds;

		// 1. Try to find existing nodes via metadata
		const existing = this.findExistingNodes();
		if (existing) {
			console.log(`[SimpleModeBridge] Found existing nodes:`, existing);
			this.nodeIds = existing;
			return existing;
		}

		// 2. Create the full graph
		console.log(`[SimpleModeBridge] No existing nodes found, creating new graph...`);
		console.log(`[SimpleModeBridge] nodeStore contents:`, nodeStore.getAllIds().map(id => {
			const n = nodeStore.get(id);
			return { id, type: n?.type, metadata: (n as any)?.metadata };
		}));
		this.nodeIds = await this.createGraph();
		console.log(`[SimpleModeBridge] Created new graph:`, this.nodeIds);
		return this.nodeIds;
	}

	/**
	 * Obtain the TripleStore for the STATE node.
	 * Must be called after `ensureGraph()`.
	 */
	async getTripleStore(): Promise<TripleStore> {
		if (!this.nodeIds) {
			throw new Error('SimpleModeBridge: call ensureGraph() first');
		}
		return getNodeRDFStore(this.nodeIds.state);
	}

	/** The resolved node IDs, or null if not yet initialised. */
	get ids(): SimpleModeNodeIds | null {
		return this.nodeIds;
	}

	// -----------------------------------------------------------------------
	// Internals – detection
	// -----------------------------------------------------------------------

	private findExistingNodes(): SimpleModeNodeIds | null {
		console.log(`[SimpleModeBridge] findExistingNodes: scanning ${nodeStore.getAllIds().length} nodes`);
		for (const id of nodeStore.getAllIds()) {
			const n = nodeStore.get(id);
			console.log(`[SimpleModeBridge]   node ${id}: type=${n?.type}, metadata=`, JSON.stringify((n as any)?.metadata));
		}
		const state = nodeStore.findByMetadata(META_KEY, ROLES.state);
		const backendVfs = nodeStore.findByMetadata(META_KEY, ROLES.backendVfs);
		const frontendVfs = nodeStore.findByMetadata(META_KEY, ROLES.frontendVfs);
		const loader = nodeStore.findByMetadata(META_KEY, ROLES.loader);
		const sandbox = nodeStore.findByMetadata(META_KEY, ROLES.sandbox);
		console.log(`[SimpleModeBridge] findExistingNodes results:`, { state: state?.id, backendVfs: backendVfs?.id, frontendVfs: frontendVfs?.id, loader: loader?.id, sandbox: sandbox?.id });

		if (state && backendVfs && frontendVfs && loader && sandbox) {
			return {
				state: state.id,
				backendVfs: backendVfs.id,
				frontendVfs: frontendVfs.id,
				loader: loader.id,
				sandbox: sandbox.id
			};
		}
		return null;
	}

	// -----------------------------------------------------------------------
	// Internals – graph creation
	// -----------------------------------------------------------------------

	private async createGraph(): Promise<SimpleModeNodeIds> {
		// Create the 5 nodes with metadata tags
		const [stateNode, backendVfsNode, frontendVfsNode, loaderNode, sandboxNode] =
			await Promise.all([
				createStateNodeData('🌍 World Data', { [META_KEY]: ROLES.state }),
				createVFSNodeData(this.projectId, '📦 Backend', { [META_KEY]: ROLES.backendVfs }),
				createVFSNodeData(this.projectId, '🎮 Frontend', { [META_KEY]: ROLES.frontendVfs }),
				createLoaderNodeData('⚙️ Engine', { [META_KEY]: ROLES.loader }),
				createSandboxNodeData('👁️ Preview', { [META_KEY]: ROLES.sandbox })
			]);

		// Persist to IndexedDB via NodeStore — flush immediately so that
		// the nodes survive a page refresh even if the debounce timer hasn't
		// fired yet.
		nodeStore.create(stateNode as StudioNodeData);
		nodeStore.create(backendVfsNode as StudioNodeData);
		nodeStore.create(frontendVfsNode as StudioNodeData);
		nodeStore.create(loaderNode as StudioNodeData);
		nodeStore.create(sandboxNode as StudioNodeData);
		await nodeStore.flush();

		// Set layout positions
		layoutStore.add(stateNode.id, LAYOUT.state.x, LAYOUT.state.y);
		layoutStore.add(backendVfsNode.id, LAYOUT['backend-vfs'].x, LAYOUT['backend-vfs'].y);
		layoutStore.add(frontendVfsNode.id, LAYOUT['frontend-vfs'].x, LAYOUT['frontend-vfs'].y);
		layoutStore.add(loaderNode.id, LAYOUT.loader.x, LAYOUT.loader.y);
		layoutStore.add(sandboxNode.id, LAYOUT.sandbox.x, LAYOUT.sandbox.y);

		// Update SvelteFlow rendering layer in real-time
		const toFlowNode = (id: string, type: NodeType, pos: { x: number; y: number }): Node<FlowNodeData> => ({
			id,
			type,
			position: pos,
			data: { id, type },
			sourcePosition: Position.Right,
			targetPosition: Position.Left
		});

		this.flowCallbacks.updateNodes((prev) => [
			...prev,
			toFlowNode(stateNode.id, 'STATE', LAYOUT.state),
			toFlowNode(backendVfsNode.id, 'VFS', LAYOUT['backend-vfs']),
			toFlowNode(frontendVfsNode.id, 'VFS', LAYOUT['frontend-vfs']),
			toFlowNode(loaderNode.id, 'LOADER', LAYOUT.loader),
			toFlowNode(sandboxNode.id, 'SANDBOX', LAYOUT.sandbox)
		]);

		// Create the 4 edges
		const newEdges: Edge[] = [
			{
				id: `e-${stateNode.id}-${loaderNode.id}`,
				source: stateNode.id,
				target: loaderNode.id,
				sourceHandle: 'default',
				targetHandle: 'loader-state'
			},
			{
				id: `e-${backendVfsNode.id}-${loaderNode.id}`,
				source: backendVfsNode.id,
				target: loaderNode.id,
				sourceHandle: 'default',
				targetHandle: 'loader-backend'
			},
			{
				id: `e-${loaderNode.id}-${sandboxNode.id}`,
				source: loaderNode.id,
				target: sandboxNode.id,
				sourceHandle: 'loader-output',
				targetHandle: 'service-input'
			},
			{
				id: `e-${frontendVfsNode.id}-${sandboxNode.id}`,
				source: frontendVfsNode.id,
				target: sandboxNode.id,
				sourceHandle: 'default',
				targetHandle: 'vfs-input'
			}
		];

		// Update SvelteFlow edges in real-time and persist
		this.flowCallbacks.updateEdges((prev) => [...prev, ...newEdges]);
		const existingEdges = await getEdges(this.projectId);
		await saveEdges([...existingEdges, ...newEdges], this.projectId);

		// Populate VFS nodes with template files
		await this.populateVfs(backendVfsNode.id, 'backend');
		await this.populateVfs(frontendVfsNode.id, 'frontend');

		const ids: SimpleModeNodeIds = {
			state: stateNode.id,
			backendVfs: backendVfsNode.id,
			frontendVfs: frontendVfsNode.id,
			loader: loaderNode.id,
			sandbox: sandboxNode.id
		};
		return ids;
	}

	// -----------------------------------------------------------------------
	// Internals – VFS template population
	// -----------------------------------------------------------------------

	/**
	 * Populate a newly created VFS node from its corresponding tar.gz template.
	 * Only called from createGraph() on freshly created nodes.
	 */
	private async populateVfs(nodeId: string, template: 'backend' | 'frontend') {
		const vfs = await getNodeVfs(this.projectId, nodeId);

		console.log(`[SimpleModeBridge] Populating VFS ${template} from template...`);

		// Fetch the tar.gz template
		// The templates are served as static assets from the studio app.
		// They need to be placed in apps/studio/static/templates/ or imported via Vite.
		const tarGzUrl = `/templates/${template}.tar.gz`;
		const response = await fetch(tarGzUrl);
		if (!response.ok) {
			console.error(`[SimpleModeBridge] Failed to fetch template ${tarGzUrl}: ${response.status}`);
			return;
		}

		const buffer = await response.arrayBuffer();

		// The server may set Content-Encoding: gzip on .tar.gz files, causing
		// the browser to auto-decompress.  Detect by checking gzip magic bytes.
		const header = new Uint8Array(buffer, 0, 2);
		const isGzip = header[0] === 0x1f && header[1] === 0x8b;
		const entries: TarEntry[] = isGzip ? await extractTarGz(buffer) : extractTar(new Uint8Array(buffer));

		for (const entry of entries) {
			const path = '/' + entry.path;
			await vfs.createFile(path, entry.content.buffer as ArrayBuffer);
		}

		console.log(`[SimpleModeBridge] VFS ${template} populated with ${entries.length} files`);
	}
}
