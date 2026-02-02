/**
 * LoaderNode Controller
 * 
 * Handles LoaderNode-specific logic:
 * - Backend lifecycle management (via LoaderBackend abstraction)
 * - Backend VFS connection handling
 * - Service registration and calling
 * 
 * Backend selection is automatic based on VFS content:
 * - init.lua present -> LuaBackend
 */

import { Position, type Node, type Edge } from '@xyflow/svelte';
import type { 
	LoaderNodeData
} from '$lib/types';
import type { FlowNodeData } from '$lib/types/flow';
import { createVFSNodeData } from '$lib/types';
import { nodeStore, layoutStore } from '$lib/persistence';
import { 
	HandleId
} from '$lib/graph';
import { getNodeVfs } from '$lib/vfs';
import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import type { LLMConfig, PubChat } from '@pubwiki/chat';
import type { RpcStub, ServiceDefinition } from '@pubwiki/sandbox-host';
import type { RDFStore } from '@pubwiki/rdfstore';

// Import loader backend abstraction
import {
	createBackendFromVfs,
	generateServiceDocs,
	type LoaderBackend,
	type BackendConfig,
	type ServiceCallResult,
	type JsModuleRegistry,
	type JsModuleDefinition,
	type GeneratedDocs
} from '$lib/loader';

// Import module factories
import { 
	createLLMModule, 
	createPubChat, 
	createPubWikiModule,
	createPartialJsonModule,
	createJsonModule,
	createStateModule,
	type PubWikiModuleContext 
} from '$lib/loader/modules';

// Re-exports for consumers
export type { ServiceDefinition, LLMConfig, ServiceCallResult };

// ============================================================================
// Types
// ============================================================================

/**
 * Loader Node runtime state (stored in memory, not persisted)
 */
interface LoaderRuntime {
	/** Backend instance */
	backend: LoaderBackend;
	/** PubChat instance for LLM access */
	pubchat?: PubChat;
	/** VFS event unsubscribe function for hot reload */
	unsubscribeVfs?: () => void;
}

/**
 * Initialize Loader result
 */
export interface LoaderInitResult {
	success: boolean;
	services: string[];
	error: string | null;
}

// ============================================================================
// State
// ============================================================================

/** Runtime state storage (nodeId -> runtime) */
const loaderRuntimes = new Map<string, LoaderRuntime>();

/** Reload callback registry (nodeId -> callbacks) */
const reloadCallbacks = new Map<string, Set<(result: LoaderInitResult) => void>>();

// ============================================================================
// Reload Event Subscription
// ============================================================================

/**
 * Subscribe to reload events for a specific loader node
 * 
 * @param nodeId - The node ID to subscribe to
 * @param callback - Callback invoked when reload completes
 * @returns Unsubscribe function
 */
export function onLoaderReload(
	nodeId: string,
	callback: (result: LoaderInitResult) => void
): () => void {
	if (!reloadCallbacks.has(nodeId)) {
		reloadCallbacks.set(nodeId, new Set());
	}
	reloadCallbacks.get(nodeId)!.add(callback);
	
	return () => {
		const callbacks = reloadCallbacks.get(nodeId);
		if (callbacks) {
			callbacks.delete(callback);
			if (callbacks.size === 0) {
				reloadCallbacks.delete(nodeId);
			}
		}
	};
}

/**
 * Notify all subscribers of a reload result
 */
function notifyReloadCallbacks(nodeId: string, result: LoaderInitResult): void {
	const callbacks = reloadCallbacks.get(nodeId);
	if (callbacks) {
		for (const callback of callbacks) {
			try {
				callback(result);
			} catch (e) {
				console.error('[LoaderController] Error in reload callback:', e);
			}
		}
	}
}

// ============================================================================
// Public API - Backend Management
// ============================================================================

/**
 * Initialize Loader Node's backend
 * 
 * Auto-detects backend type based on VFS contents:
 * - init.lua present -> LuaBackend
 * 
 * @param nodeId - The node ID
 * @param backendVfs - Backend VFS instance
 * @param assetMounts - Map of mount paths to VFS instances
 * @param rdfStore - Optional RDF store for State API
 * @param llmConfig - LLM configuration from user settings (apiKey, model, baseUrl)
 * @param pubwikiContext - Optional context for PubWiki module (publish/article upload)
 * @returns LoaderInitResult with success, services, and error
 */
export async function initializeLoader(
	nodeId: string,
	backendVfs: Vfs<VfsProvider>,
	assetMounts: Map<string, Vfs<VfsProvider>>,
	rdfStore: RDFStore | undefined,
	llmConfig: LLMConfig | undefined,
	pubwikiContext?: PubWikiModuleContext
): Promise<LoaderInitResult> {
	try {
		// Clean up existing runtime if any
		await destroyLoader(nodeId);
		
		// Auto-detect and create backend
		const backend = await createBackendFromVfs(backendVfs);
		if (!backend) {
			return {
				success: false,
				services: [],
				error: 'No supported backend found. Ensure init.lua exists in the VFS.'
			};
		}
		
		// Build JS modules registry
		const jsModules: JsModuleRegistry = new Map();
		
		// Register JSON module (preload - available globally)
		jsModules.set('json', { module: createJsonModule(), mode: 'global' });
		
		// Register State module if RDF store is available (preload - available globally)
		if (rdfStore) {
			jsModules.set('State', { module: createStateModule(rdfStore), mode: 'global' });
		}
		
		// Create PubChat and LLM module if config is provided
		// Uses RDFMessageStore when rdfStore is available, otherwise MemoryMessageStore
		let pubchat: PubChat | undefined;
		const { pubchat: pc, messageStore } = createPubChat({ 
			llmConfig: llmConfig ?? {}, 
			rdfStore: rdfStore as BackendConfig['rdfStore']
		});
		pubchat = pc;
		jsModules.set('LLM', { module: createLLMModule(pubchat, messageStore) });
		
		// Register PubWiki module if context is provided
		if (pubwikiContext) {
			jsModules.set('pubwiki', { module: createPubWikiModule(pubwikiContext) });
		}
		
		// Register partial-json module (always available)
		jsModules.set('partial-json', { module: createPartialJsonModule() });
		
		// Build backend config
		const config: BackendConfig = {
			backendVfs,
			assetMounts,
			rdfStore: rdfStore as BackendConfig['rdfStore'],
			llmConfig,
			jsModules
		};
		
		// Initialize backend
		const result = await backend.initialize(config);
		
		if (!result.success) {
			return result;
		}
		
		// Set up VFS hot reload listener
		// Debounce reload to avoid rapid consecutive reloads
		let reloadTimeout: ReturnType<typeof setTimeout> | null = null;
		const unsubscribeVfs = backendVfs.events.onAny((event) => {
			// Only react to file changes (not folder events)
			if (!event.type.startsWith('file:')) return;
			
			console.log(`[LoaderController] VFS change detected: ${event.type}`, event);
			
			// Debounce: wait 300ms before reloading
			if (reloadTimeout) {
				clearTimeout(reloadTimeout);
			}
			reloadTimeout = setTimeout(async () => {
				reloadTimeout = null;
				const runtime = loaderRuntimes.get(nodeId);
				if (runtime?.backend) {
					console.log(`[LoaderController] Hot reloading backend for node ${nodeId}...`);
					const reloadResult = await runtime.backend.reload();
					if (reloadResult.success) {
						console.log(`[LoaderController] Reload successful. Services: ${reloadResult.services.join(', ')}`);
					} else {
						console.error(`[LoaderController] Reload failed: ${reloadResult.error}`);
					}
					// Notify UI subscribers
					notifyReloadCallbacks(nodeId, reloadResult);
				}
			}, 300);
		});
		
		// Store runtime state with unsubscribe function
		loaderRuntimes.set(nodeId, { backend, pubchat, unsubscribeVfs });
		
		return result;
	} catch (error) {
		return {
			success: false,
			services: [],
			error: error instanceof Error ? error.message : String(error)
		};
	}
}

/**
 * Destroy Loader Node's backend
 */
export async function destroyLoader(nodeId: string): Promise<void> {
	const runtime = loaderRuntimes.get(nodeId);
	if (runtime) {
		// Unsubscribe from VFS events
		if (runtime.unsubscribeVfs) {
			runtime.unsubscribeVfs();
		}
		await runtime.backend.destroy();
		loaderRuntimes.delete(nodeId);
	}
}

/**
 * Check if Loader Node is ready
 */
export function isLoaderReady(nodeId: string): boolean {
	const runtime = loaderRuntimes.get(nodeId);
	return runtime?.backend.isReady() ?? false;
}

/**
 * Get the backend type for a Loader Node
 */
export function getLoaderBackendType(nodeId: string): string | null {
	const runtime = loaderRuntimes.get(nodeId);
	return runtime?.backend.type ?? null;
}

/**
 * Reload Loader Node's backend (hot reload)
 * 
 * Manually trigger a reload of the backend. This is also called automatically
 * when files in the backend VFS change.
 * 
 * @param nodeId - The node ID
 * @returns LoaderInitResult with success, services, and error
 */
export async function reloadLoader(nodeId: string): Promise<LoaderInitResult> {
	const runtime = loaderRuntimes.get(nodeId);
	if (!runtime) {
		return {
			success: false,
			services: [],
			error: 'Loader not initialized'
		};
	}
	
	console.log(`[LoaderController] Manual reload for node ${nodeId}...`);
	return runtime.backend.reload();
}

/**
 * List services from Loader Node
 */
export async function listServices(nodeId: string): Promise<ServiceDefinition[]> {
	const runtime = loaderRuntimes.get(nodeId);
	if (!runtime) {
		throw new Error('Loader not initialized');
	}
	
	return runtime.backend.listServices();
}

/**
 * Call a service on Loader Node
 */
export async function callService(
	nodeId: string,
	identifier: string,
	inputs: Record<string, unknown>
): Promise<ServiceCallResult> {
	const runtime = loaderRuntimes.get(nodeId);
	if (!runtime) {
		return { success: false, error: 'Loader not initialized' };
	}
	
	return runtime.backend.callService(identifier, inputs);
}

/**
 * Call a streaming service on Loader Node
 */
export async function streamService(
	nodeId: string,
	identifier: string,
	inputs: Record<string, unknown>,
	on: RpcStub<(value: unknown) => Promise<void> | void>
): Promise<void> {
	const runtime = loaderRuntimes.get(nodeId);
	if (!runtime) {
		throw new Error('Loader not initialized');
	}
	
	return runtime.backend.streamService(identifier, inputs, on);
}

// ============================================================================
// Connection Helpers
// ============================================================================

/**
 * Find the backend VFS node connected to a Loader node
 * Returns the node ID of the connected VFS node if found
 */
export function findBackendVfsNode(
	nodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): string | null {
	const backendEdge = edges.find(
		e => e.target === nodeId && e.targetHandle === HandleId.LOADER_BACKEND
	);
	
	if (!backendEdge) return null;
	
	const sourceNode = nodes.find(n => n.id === backendEdge.source);
	if (!sourceNode) return null;
	
	const sourceData = nodeStore.get(sourceNode.id);
	if (sourceData?.type === 'VFS') {
		return sourceNode.id;
	}
	
	return null;
}

/**
 * Find all asset VFS nodes connected to a Loader node via LOADER_ASSET_VFS handle
 * Returns a map of mount path -> VFS node ID
 * 
 * This uses the new VFS mount mechanism where VFSContent.mounts tracks connections.
 * The mount path is stored in the source VFS's mounts array.
 */
export function findMountedVfsNodes(
	nodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): Map<string, string> {
	const result = new Map<string, string>();
	
	// Find edges where this Loader node is the target and handle is LOADER_ASSET_VFS
	for (const edge of edges) {
		if (edge.target === nodeId && edge.targetHandle === HandleId.LOADER_ASSET_VFS) {
			const sourceNode = nodes.find(n => n.id === edge.source);
			if (!sourceNode) continue;
			
			const sourceData = nodeStore.get(sourceNode.id);
			if (sourceData?.type === 'VFS') {
				const vfsContent = sourceData.content as import('$lib/types').VFSContent;
				// Find the mount config in the source VFS that points to this connection
				// The mount config stores sourceNodeId (the VFS being mounted) and mountPath
				// In the VFS->Loader connection, the VFS stores its own mount configuration
				for (const mount of vfsContent.mounts) {
					// If this mount's sourceNodeId matches the VFS itself (self-reference for loader mount)
					// Or if we use node name as the mount path
					result.set(mount.mountPath, sourceNode.id);
				}
				
				// If no specific mount config, use node name or root path
				if (vfsContent.mounts.length === 0) {
					const mountPath = sourceData.name ? `/${sourceData.name}` : '/';
					result.set(mountPath, sourceNode.id);
				}
			}
		}
	}
	
	return result;
}

/**
 * Find the State node connected to a Loader node via the state handle
 * Returns the node ID of the connected State node if found
 */
export function findStateNode(
	nodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): string | null {
	const stateEdge = edges.find(
		e => e.target === nodeId && e.targetHandle === HandleId.LOADER_STATE
	);
	
	if (!stateEdge) return null;
	
	const sourceNode = nodes.find(n => n.id === stateEdge.source);
	if (!sourceNode) return null;
	
	const sourceData = nodeStore.get(sourceNode.id);
	if (sourceData?.type === 'STATE') {
		return sourceNode.id;
	}
	
	return null;
}

// ============================================================================
// Loader Interface (for Sandbox Node integration)
// ============================================================================

/**
 * Loader Node interface for Sandbox Node
 */
export interface LoaderInterface {
	/** Check if Loader is ready */
	isReady(): boolean;
	/** Get backend type */
	getBackendType(): string | null;
	/** Get registered services list */
	listServices(): Promise<ServiceDefinition[]>;
	/** Call a service (non-streaming) */
	callService(identifier: string, inputs: Record<string, unknown>): Promise<ServiceCallResult>;
	/** Call a streaming service with callback */
	streamService(
		identifier: string, 
		inputs: Record<string, unknown>,
		on: RpcStub<(value: unknown) => Promise<void> | void>
	): Promise<void>;
}

/**
 * Create Loader interface for a node
 */
export function createLoaderInterface(nodeId: string): LoaderInterface {
	return {
		isReady: () => isLoaderReady(nodeId),
		getBackendType: () => getLoaderBackendType(nodeId),
		listServices: () => listServices(nodeId),
		callService: (id, inputs) => callService(nodeId, id, inputs),
		streamService: (id, inputs, on) => streamService(nodeId, id, inputs, on),
	};
}

// ============================================================================
// Event Handler Registration
// ============================================================================

/**
 * Register Loader Node event handlers
 * Should be called once when the Studio component mounts
 * 
 * Note: VFS mounting is now handled via drag-to-folder gesture in VFSNode.
 * This function is kept for future Loader-specific event handling.
 */
export function registerLoaderNodeHandlers(): () => void {
	// Currently no Loader-specific event handlers needed
	// VFS mounting is done via drag-to-folder gesture
	return () => {};
}

// ============================================================================
// Documentation Generation
// ============================================================================

/**
 * Result from documentation generation
 */
export interface DocsGenerationResult {
	success: boolean;
	vfsNodeId?: string;
	error?: string;
}

/**
 * Callbacks for docs generation operations
 */
export interface DocsGenerationCallbacks {
	updateNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void;
	updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
}

/**
 * Generate documentation for Loader services and create a VFS node
 * 
 * @param loaderId - The Loader node ID
 * @param callbacks - Callbacks to update flow nodes and edges
 * @param existingVfsNodeId - Optional existing VFS node ID to update instead of creating new
 * @returns Result with success status and VFS node ID
 */
export async function generateDocs(
	loaderId: string,
	callbacks: DocsGenerationCallbacks,
	existingVfsNodeId?: string
): Promise<DocsGenerationResult> {
	try {
		// 1. Get services list
		const services = await listServices(loaderId);
		if (services.length === 0) {
			return { success: false, error: 'No services registered' };
		}

		// 2. Generate documentation
		const docs = generateServiceDocs(services);

		let vfsNodeId: string;
		let projectId: string;

		if (existingVfsNodeId) {
			// Update existing VFS node
			const existingNodeData = nodeStore.get(existingVfsNodeId);
			if (!existingNodeData || existingNodeData.type !== 'VFS') {
				return { success: false, error: 'Existing VFS node not found' };
			}
			vfsNodeId = existingVfsNodeId;
			projectId = (existingNodeData.content as { projectId: string }).projectId;
		} else {
			// 3. Create new VFS node
			projectId = crypto.randomUUID();
			const vfsNodeData = await createVFSNodeData(projectId, 'Service Docs');
			nodeStore.create(vfsNodeData);
			vfsNodeId = vfsNodeData.id;

			// 4. Calculate position (to the right of Loader node)
			const loaderLayout = layoutStore.get(loaderId);
			const position = loaderLayout
				? { x: loaderLayout.x + 300, y: loaderLayout.y + 50 }
				: { x: 300, y: 0 };
			layoutStore.add(vfsNodeId, position.x, position.y);

			// 5. Create flow node
			const vfsFlowNode: Node<FlowNodeData> = {
				id: vfsNodeId,
				type: 'VFS',
				data: { id: vfsNodeId, type: 'VFS' },
				position,
				sourcePosition: Position.Right,
				targetPosition: Position.Left,
			};

			// 6. Create edge
			const vfsEdge: Edge = {
				id: `e-${loaderId}-${vfsNodeId}-docs`,
				source: loaderId,
				sourceHandle: HandleId.LOADER_DOCS_OUTPUT,
				target: vfsNodeId,
				targetHandle: HandleId.VFS_GENERATOR_INPUT,
			};
			console.log('[LoaderController] Creating VFS edge:', vfsEdge);

			// 7. Add node and edge to flow
			callbacks.updateNodes(nodes => [...nodes, vfsFlowNode]);
			callbacks.updateEdges(edges => [...edges, vfsEdge]);
		}

		// 8. Write docs to VFS (create or overwrite)
		const vfs = await getNodeVfs(projectId, vfsNodeId);
		
		// Use updateFile to overwrite existing files, or createFile for new ones
		const writeOrCreate = async (path: string, content: string) => {
			try {
				// Try to check if file exists by reading it first
				await vfs.readFile(path);
				// File exists, update it
				await vfs.updateFile(path, content);
			} catch {
				// File doesn't exist, create it
				await vfs.createFile(path, content);
			}
		};
		
		await writeOrCreate('/index.ts', docs.indexTs);
		await writeOrCreate('/services.d.ts', docs.servicesDts);
		await writeOrCreate('/services.md', docs.servicesMd);
		await writeOrCreate('/agents.md', docs.agentsMd);

		console.log(`[LoaderController] ${existingVfsNodeId ? 'Regenerated' : 'Generated'} docs for ${loaderId}, VFS: ${vfsNodeId}`);
		return { success: true, vfsNodeId };
	} catch (error) {
		console.error('[LoaderController] Failed to generate docs:', error);
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error)
		};
	}
}
