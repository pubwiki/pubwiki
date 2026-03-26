/**
 * Simple Mode Bridge
 *
 * Automatically creates and maintains a minimal flow-graph when the user is
 * in "simple mode".  The graph consists of 7 nodes and 4 edges that wire
 * STATE, VFS (backend + frontend + game-sdk + game-ui), LOADER, and SANDBOX
 * together.  game-sdk and game-ui are mounted into the frontend VFS as
 * read-only library directories.
 *
 * Node identification relies on `metadata["simple-mode-role"]`.
 */

import { extractTar, extractTarGz, type TarEntry, createVfsMountHandleId } from '@pubwiki/flow-core';
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
	type StudioNodeData,
	VFSContent
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
	gameSdkVfs: 'game-sdk-vfs',
	gameUiVfs: 'game-ui-vfs',
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
	'game-sdk-vfs': { x: 0, y: 500 },
	'game-ui-vfs': { x: 400, y: 500 },
	sandbox: { x: 800, y: 250 }
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SimpleModeNodeIds {
	state: string;
	backendVfs: string;
	frontendVfs: string;
	gameSdkVfs: string;
	gameUiVfs: string;
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
		} else {
			// 2. Create the full graph
			console.log(`[SimpleModeBridge] No existing nodes found, creating new graph...`);
			this.nodeIds = await this.createGraph();
			console.log(`[SimpleModeBridge] Created new graph:`, this.nodeIds);
		}

		// Mount relationships are persisted in VFS node content.mounts,
		// so getNodeVfs() auto-restores them. No explicit setup needed here.

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
		const state = nodeStore.findByMetadata(META_KEY, ROLES.state);
		const backendVfs = nodeStore.findByMetadata(META_KEY, ROLES.backendVfs);
		const frontendVfs = nodeStore.findByMetadata(META_KEY, ROLES.frontendVfs);
		const gameSdkVfs = nodeStore.findByMetadata(META_KEY, ROLES.gameSdkVfs);
		const gameUiVfs = nodeStore.findByMetadata(META_KEY, ROLES.gameUiVfs);
		const loader = nodeStore.findByMetadata(META_KEY, ROLES.loader);
		const sandbox = nodeStore.findByMetadata(META_KEY, ROLES.sandbox);

		if (state && backendVfs && frontendVfs && gameSdkVfs && gameUiVfs && loader && sandbox) {
			return {
				state: state.id,
				backendVfs: backendVfs.id,
				frontendVfs: frontendVfs.id,
				gameSdkVfs: gameSdkVfs.id,
				gameUiVfs: gameUiVfs.id,
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
		// Create the 7 nodes with metadata tags
		const [stateNode, backendVfsNode, frontendVfsNode, gameSdkVfsNode, gameUiVfsNode, loaderNode, sandboxNode] =
			await Promise.all([
				createStateNodeData('🌍 World Data', { [META_KEY]: ROLES.state }),
				createVFSNodeData(this.projectId, '📦 Backend', { [META_KEY]: ROLES.backendVfs }),
				createVFSNodeData(this.projectId, '🎮 Frontend', { [META_KEY]: ROLES.frontendVfs }),
				createVFSNodeData(this.projectId, '📊 Game SDK', { [META_KEY]: ROLES.gameSdkVfs }),
				createVFSNodeData(this.projectId, '🎨 Game UI', { [META_KEY]: ROLES.gameUiVfs }),
				createLoaderNodeData('⚙️ Engine', { [META_KEY]: ROLES.loader }),
				createSandboxNodeData('👁️ Preview', { [META_KEY]: ROLES.sandbox })
			]);

		// Persist to IndexedDB via NodeStore — flush immediately so that
		// the nodes survive a page refresh even if the debounce timer hasn't
		// fired yet.
		nodeStore.create(stateNode as StudioNodeData);
		nodeStore.create(backendVfsNode as StudioNodeData);
		nodeStore.create(frontendVfsNode as StudioNodeData);
		nodeStore.create(gameSdkVfsNode as StudioNodeData);
		nodeStore.create(gameUiVfsNode as StudioNodeData);
		nodeStore.create(loaderNode as StudioNodeData);
		nodeStore.create(sandboxNode as StudioNodeData);
		await nodeStore.flush();

		// Set layout positions
		layoutStore.add(stateNode.id, LAYOUT.state.x, LAYOUT.state.y);
		layoutStore.add(backendVfsNode.id, LAYOUT['backend-vfs'].x, LAYOUT['backend-vfs'].y);
		layoutStore.add(frontendVfsNode.id, LAYOUT['frontend-vfs'].x, LAYOUT['frontend-vfs'].y);
		layoutStore.add(gameSdkVfsNode.id, LAYOUT['game-sdk-vfs'].x, LAYOUT['game-sdk-vfs'].y);
		layoutStore.add(gameUiVfsNode.id, LAYOUT['game-ui-vfs'].x, LAYOUT['game-ui-vfs'].y);
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
			toFlowNode(gameSdkVfsNode.id, 'VFS', LAYOUT['game-sdk-vfs']),
			toFlowNode(gameUiVfsNode.id, 'VFS', LAYOUT['game-ui-vfs']),
			toFlowNode(loaderNode.id, 'LOADER', LAYOUT.loader),
			toFlowNode(sandboxNode.id, 'SANDBOX', LAYOUT.sandbox)
		]);

		// Create 7 edges: 4 data-flow + 3 mount edges
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
			},
			// Mount edges: game-sdk → game-ui, game-sdk → frontend, game-ui → frontend
			{
				id: `${gameSdkVfsNode.id}-${gameUiVfsNode.id}-mount-game-sdk`,
				source: gameSdkVfsNode.id,
				target: gameUiVfsNode.id,
				sourceHandle: 'default',
				targetHandle: createVfsMountHandleId('mount-game-sdk')
			},
			{
				id: `${gameSdkVfsNode.id}-${frontendVfsNode.id}-mount-game-sdk`,
				source: gameSdkVfsNode.id,
				target: frontendVfsNode.id,
				sourceHandle: 'default',
				targetHandle: createVfsMountHandleId('mount-game-sdk')
			},
			{
				id: `${gameUiVfsNode.id}-${frontendVfsNode.id}-mount-game-ui`,
				source: gameUiVfsNode.id,
				target: frontendVfsNode.id,
				sourceHandle: 'default',
				targetHandle: createVfsMountHandleId('mount-game-ui')
			}
		];

		// Update SvelteFlow edges in real-time and persist
		this.flowCallbacks.updateEdges((prev) => [...prev, ...newEdges]);
		const existingEdges = await getEdges(this.projectId);
		await saveEdges([...existingEdges, ...newEdges], this.projectId);

		// Populate VFS nodes with template files
		await this.populateVfs(backendVfsNode.id, 'backend');
		await this.populateVfs(frontendVfsNode.id, 'frontend');
		await this.populateVfs(gameSdkVfsNode.id, 'game-sdk');
		await this.populateVfs(gameUiVfsNode.id, 'game-ui');

		const ids: SimpleModeNodeIds = {
			state: stateNode.id,
			backendVfs: backendVfsNode.id,
			frontendVfs: frontendVfsNode.id,
			gameSdkVfs: gameSdkVfsNode.id,
			gameUiVfs: gameUiVfsNode.id,
			loader: loaderNode.id,
			sandbox: sandboxNode.id
		};

		// Persist mount configurations to VFS node content so that
		// getNodeVfs() can auto-restore mounts on page refresh.
		await this.persistAndSetupMounts(ids);

		return ids;
	}

	// -----------------------------------------------------------------------
	// Internals – VFS mounts & template population
	// -----------------------------------------------------------------------

	/**
	 * Persist mount configurations into VFS node content and set up
	 * in-memory mounts on the already-cached NodeVfs instances.
	 *
	 * Only called from createGraph(). On subsequent page refreshes,
	 * getNodeVfs() reads content.mounts and auto-restores mounts.
	 */
	private async persistAndSetupMounts(ids: SimpleModeNodeIds): Promise<void> {
		// 1. Persist mount configs to node content (survives page refresh)
		// Cast needed: StudioNodeData is a union + index-signature intersection that
		// TypeScript can't narrow through object spread.
		nodeStore.update(ids.gameUiVfs, (data) => ({
			...data,
			content: (data.content as VFSContent)
				.addMount({ id: 'mount-game-sdk', sourceNodeId: ids.gameSdkVfs, mountPath: '/lib/game-sdk' })
		}) as unknown as StudioNodeData);
		nodeStore.update(ids.frontendVfs, (data) => ({
			...data,
			content: (data.content as VFSContent)
				.addMount({ id: 'mount-game-sdk', sourceNodeId: ids.gameSdkVfs, mountPath: '/lib/game-sdk' })
				.addMount({ id: 'mount-game-ui', sourceNodeId: ids.gameUiVfs, mountPath: '/lib/game-ui' })
		}) as unknown as StudioNodeData);
		await nodeStore.flush();

		// 2. Set up in-memory mounts on cached NodeVfs instances
		//    (populateVfs already called getNodeVfs which cached them)
		const frontendVfs = await getNodeVfs(this.projectId, ids.frontendVfs);
		const gameSdkVfs = await getNodeVfs(this.projectId, ids.gameSdkVfs);
		const gameUiVfs = await getNodeVfs(this.projectId, ids.gameUiVfs);

		gameUiVfs.mount('/lib/game-sdk', gameSdkVfs, ids.gameSdkVfs);
		frontendVfs.mount('/lib/game-sdk', gameSdkVfs, ids.gameSdkVfs);
		frontendVfs.mount('/lib/game-ui', gameUiVfs, ids.gameUiVfs);

		console.log('[SimpleModeBridge] VFS mounts persisted and established');
	}

	private async populateVfs(nodeId: string, template: 'backend' | 'frontend' | 'game-sdk' | 'game-ui') {
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
