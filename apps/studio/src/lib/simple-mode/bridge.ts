/**
 * Simple Mode Bridge
 *
 * Automatically creates and maintains a minimal flow-graph when the user is
 * in "simple mode".  The graph consists of 8 nodes and edges that wire
 * STATE, VFS (backend + frontend + game-sdk + game-ui + docs), LOADER, and
 * SANDBOX together.  game-sdk and game-ui are mounted into the frontend VFS
 * as read-only library directories.  The docs VFS is auto-generated from
 * loader services and mounted into game-sdk at /generated/.
 *
 * Node identification relies on `metadata["simple-mode-role"]`.
 */

import { extractTar, extractTarGz, type TarEntry, createVfsMountHandleId, HandleId } from '@pubwiki/flow-core';
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
	docsVfs: 'docs-vfs',
	copilotSkillsVfs: 'copilot-skills-vfs',
	designerSkillsVfs: 'designer-skills-vfs',
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
	'docs-vfs': { x: 0, y: 375 },
	'copilot-skills-vfs': { x: 0, y: 625 },
	'designer-skills-vfs': { x: 400, y: 625 },
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
	docsVfs: string;
	copilotSkillsVfs: string;
	designerSkillsVfs: string;
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
		const docsVfs = nodeStore.findByMetadata(META_KEY, ROLES.docsVfs);
		const copilotSkillsVfs = nodeStore.findByMetadata(META_KEY, ROLES.copilotSkillsVfs);
		const designerSkillsVfs = nodeStore.findByMetadata(META_KEY, ROLES.designerSkillsVfs);
		const loader = nodeStore.findByMetadata(META_KEY, ROLES.loader);
		const sandbox = nodeStore.findByMetadata(META_KEY, ROLES.sandbox);

		if (state && backendVfs && frontendVfs && gameSdkVfs && gameUiVfs && docsVfs && copilotSkillsVfs && designerSkillsVfs && loader && sandbox) {
			return {
				state: state.id,
				backendVfs: backendVfs.id,
				frontendVfs: frontendVfs.id,
				gameSdkVfs: gameSdkVfs.id,
				gameUiVfs: gameUiVfs.id,
				docsVfs: docsVfs.id,
				copilotSkillsVfs: copilotSkillsVfs.id,
				designerSkillsVfs: designerSkillsVfs.id,
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
		// Create the 10 nodes with metadata tags
		const [stateNode, backendVfsNode, frontendVfsNode, gameSdkVfsNode, gameUiVfsNode, docsVfsNode, copilotSkillsVfsNode, designerSkillsVfsNode, loaderNode, sandboxNode] =
			await Promise.all([
				createStateNodeData('🌍 World Data', { [META_KEY]: ROLES.state }),
				createVFSNodeData(this.projectId, '📦 Backend', { [META_KEY]: ROLES.backendVfs }),
				createVFSNodeData(this.projectId, '🎮 Frontend', { [META_KEY]: ROLES.frontendVfs }),
				createVFSNodeData(this.projectId, '📊 Game SDK', { [META_KEY]: ROLES.gameSdkVfs }),
				createVFSNodeData(this.projectId, '🎨 Game UI', { [META_KEY]: ROLES.gameUiVfs }),
				createVFSNodeData(this.projectId, '📄 Service Types', { [META_KEY]: ROLES.docsVfs }),
				createVFSNodeData(this.projectId, '📚 Copilot Skills', { [META_KEY]: ROLES.copilotSkillsVfs }),
				createVFSNodeData(this.projectId, '📚 Designer Skills', { [META_KEY]: ROLES.designerSkillsVfs }),
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
		nodeStore.create(docsVfsNode as StudioNodeData);
		nodeStore.create(copilotSkillsVfsNode as StudioNodeData);
		nodeStore.create(designerSkillsVfsNode as StudioNodeData);
		nodeStore.create(loaderNode as StudioNodeData);
		nodeStore.create(sandboxNode as StudioNodeData);
		await nodeStore.flush();

		// Set layout positions
		layoutStore.add(stateNode.id, LAYOUT.state.x, LAYOUT.state.y);
		layoutStore.add(backendVfsNode.id, LAYOUT['backend-vfs'].x, LAYOUT['backend-vfs'].y);
		layoutStore.add(frontendVfsNode.id, LAYOUT['frontend-vfs'].x, LAYOUT['frontend-vfs'].y);
		layoutStore.add(gameSdkVfsNode.id, LAYOUT['game-sdk-vfs'].x, LAYOUT['game-sdk-vfs'].y);
		layoutStore.add(gameUiVfsNode.id, LAYOUT['game-ui-vfs'].x, LAYOUT['game-ui-vfs'].y);
		layoutStore.add(docsVfsNode.id, LAYOUT['docs-vfs'].x, LAYOUT['docs-vfs'].y);
		layoutStore.add(copilotSkillsVfsNode.id, LAYOUT['copilot-skills-vfs'].x, LAYOUT['copilot-skills-vfs'].y);
		layoutStore.add(designerSkillsVfsNode.id, LAYOUT['designer-skills-vfs'].x, LAYOUT['designer-skills-vfs'].y);
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
			toFlowNode(docsVfsNode.id, 'VFS', LAYOUT['docs-vfs']),
			toFlowNode(copilotSkillsVfsNode.id, 'VFS', LAYOUT['copilot-skills-vfs']),
			toFlowNode(designerSkillsVfsNode.id, 'VFS', LAYOUT['designer-skills-vfs']),
			toFlowNode(loaderNode.id, 'LOADER', LAYOUT.loader),
			toFlowNode(sandboxNode.id, 'SANDBOX', LAYOUT.sandbox)
		]);

		// Create edges: 4 data-flow + 3 mount edges + 2 docs edges
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
			},
			// Docs edges: loader → docs VFS, docs VFS → game-sdk mount
			{
				id: `e-${loaderNode.id}-${docsVfsNode.id}-docs`,
				source: loaderNode.id,
				sourceHandle: HandleId.LOADER_DOCS_OUTPUT,
				target: docsVfsNode.id,
				targetHandle: HandleId.VFS_GENERATOR_INPUT
			},
			{
				id: `${docsVfsNode.id}-${gameSdkVfsNode.id}-mount-docs`,
				source: docsVfsNode.id,
				target: gameSdkVfsNode.id,
				sourceHandle: 'default',
				targetHandle: createVfsMountHandleId('mount-docs')
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
		await this.populateVfs(copilotSkillsVfsNode.id, 'copilot-skills');
		await this.populateVfs(designerSkillsVfsNode.id, 'designer-skills');

		const ids: SimpleModeNodeIds = {
			state: stateNode.id,
			backendVfs: backendVfsNode.id,
			frontendVfs: frontendVfsNode.id,
			gameSdkVfs: gameSdkVfsNode.id,
			gameUiVfs: gameUiVfsNode.id,
			docsVfs: docsVfsNode.id,
			copilotSkillsVfs: copilotSkillsVfsNode.id,
			designerSkillsVfs: designerSkillsVfsNode.id,
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
		nodeStore.update(ids.gameSdkVfs, (data) => ({
			...data,
			content: (data.content as VFSContent)
				.addMount({ id: 'mount-docs', sourceNodeId: ids.docsVfs, mountPath: '/generated' })
		}) as unknown as StudioNodeData);
		await nodeStore.flush();

		// 2. Set up in-memory mounts on cached NodeVfs instances
		//    (populateVfs already called getNodeVfs which cached them)
		const frontendVfs = await getNodeVfs(this.projectId, ids.frontendVfs);
		const gameSdkVfs = await getNodeVfs(this.projectId, ids.gameSdkVfs);
		const gameUiVfs = await getNodeVfs(this.projectId, ids.gameUiVfs);
		const docsVfs = await getNodeVfs(this.projectId, ids.docsVfs);

		gameUiVfs.mount('/lib/game-sdk', gameSdkVfs, ids.gameSdkVfs);
		frontendVfs.mount('/lib/game-sdk', gameSdkVfs, ids.gameSdkVfs);
		frontendVfs.mount('/lib/game-ui', gameUiVfs, ids.gameUiVfs);
		gameSdkVfs.mount('/generated', docsVfs, ids.docsVfs);

		console.log('[SimpleModeBridge] VFS mounts persisted and established');
	}

	private async populateVfs(nodeId: string, template: 'backend' | 'frontend' | 'game-sdk' | 'game-ui' | 'copilot-skills' | 'designer-skills') {
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
