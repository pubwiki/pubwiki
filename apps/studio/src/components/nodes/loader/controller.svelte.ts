/**
 * LoaderNode Controller
 * 
 * Handles LoaderNode-specific logic:
 * - Backend lifecycle management (via LoaderBackend abstraction)
 * - Backend VFS connection handling
 * - Mountpoint management for asset VFS
 * - Service registration and calling
 * 
 * Backend selection is automatic based on VFS content:
 * - init.lua present -> LuaBackend
 */

import { tick } from 'svelte';
import { type Node, type Edge } from '@xyflow/svelte';
import type { 
	LoaderNodeData, 
	Mountpoint
} from '$lib/types';
import type { FlowNodeData } from '$lib/types/flow';
import { nodeStore } from '$lib/persistence';
import { 
	HandleId, 
	isLoaderMountpointHandle, 
	getLoaderMountpointId, 
	createLoaderMountpointHandleId,
	generateMountpointId
} from '$lib/graph';
import { 
	onConnection, 
	onEdgeDelete,
	type ConnectionEvent,
	type EdgeDeleteEvent
} from '$lib/state';
import { getNodeVfs } from '$lib/vfs';
import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import { 
	PubChat, 
	MemoryMessageStore,
	type LLMConfig
} from '@pubwiki/chat';
import type { RpcStub, ServiceDefinition } from '@pubwiki/sandbox-host';

// Import loader backend abstraction
import {
	createBackendFromVfs,
	type LoaderBackend,
	type BackendConfig,
	type ServiceCallResult,
	type JsModuleRegistry,
	type JsModuleDefinition
} from '$lib/loader';

// Import PubWiki module factory
import { createPubWikiModule, type PubWikiModuleContext } from '$lib/modules/pubwiki';

// Re-exports for consumers
export type { ServiceDefinition, LLMConfig, ServiceCallResult };

// ============================================================================
// LLM Module Factory
// ============================================================================

/**
 * Create a JS module definition for LLM access
 * 
 * The module exposes:
 * - LLM.chat(prompt: string, historyId?: string, overrideConfig?: table) -> {content: string, historyId: string}
 * - LLM.stream(prompt: string, historyId?: string, overrideConfig?: table) -> iterator of events
 * 
 * @param pubchat PubChat instance to wrap
 * @returns JsModuleDefinition for registerJsModule
 */
function createLLMModule(pubchat: PubChat): JsModuleDefinition {
	return {
		/**
		 * Non-streaming chat
		 */
		async chat(...args: unknown[]) {
			const [prompt, historyId, overrideConfig] = args as [string, string?, Partial<LLMConfig>?];
			const result = await pubchat.chat(prompt, historyId, overrideConfig);
			// Extract text content from message blocks
			const content = result.message.blocks
				.filter(b => b.type === 'markdown' || b.type === 'text')
				.map(b => b.content)
				.join('');
			return {
				content,
				historyId: result.historyId
			};
		},
		
		/**
		 * Streaming chat - returns an async iterator
		 */
		stream(...args: unknown[]) {
			const [prompt, historyId, overrideConfig] = args as [string, string?, Partial<LLMConfig>?];
			return pubchat.streamChat(prompt, historyId, overrideConfig);
		},
		
		/**
		 * Abort current generation
		 */
		abort() {
			pubchat.abort();
		}
	};
}

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

/** Currently editing mountpoint (node-local state, exposed for UI) */
let editingMountpoint: { nodeId: string; mountpointId: string } | null = $state(null);

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
// Mountpoint Helpers
// ============================================================================

/** Initial mountpoint path - user must edit */
const INITIAL_MOUNTPOINT_PATH = '/';

/** Regex for valid mountpoint path characters (after the leading /) */
const VALID_PATH_CHARS = /^[0-9a-zA-Z]*$/;

/**
 * Validate a mountpoint path
 * @param path - The path to validate
 * @param existingMountpoints - All mountpoints in the node
 * @param currentMountpointId - The ID of the mountpoint being edited (to exclude from duplicate check)
 * @returns Error message if invalid, null if valid
 */
export function validateMountpointPath(
	path: string, 
	existingMountpoints: Mountpoint[], 
	currentMountpointId?: string
): string | null {
	// Must start with /
	if (!path.startsWith('/')) {
		return 'Path must start with /';
	}
	
	const pathPart = path.slice(1); // Remove leading /
	
	// Only allow alphanumeric characters (empty is OK for root /)
	if (!VALID_PATH_CHARS.test(pathPart)) {
		return 'Path can only contain letters and numbers (a-z, A-Z, 0-9)';
	}
	
	// Check for duplicates (excluding the current mountpoint being edited)
	const otherPaths = existingMountpoints
		.filter(mp => mp.id !== currentMountpointId)
		.map(mp => mp.path);
	
	if (otherPaths.includes(path)) {
		return 'This path already exists';
	}
	
	return null; // Valid
}

// ============================================================================
// Public API - Mountpoint Management
// ============================================================================

/**
 * Get the currently editing mountpoint
 */
export function getEditingMountpoint(): { nodeId: string; mountpointId: string } | null {
	return editingMountpoint;
}

/**
 * Set the editing mountpoint (called from UI when editing completes)
 */
export function setEditingMountpoint(mp: { nodeId: string; mountpointId: string } | null): void {
	editingMountpoint = mp;
}

/**
 * Update a mountpoint path in a Loader node
 */
export function updateMountpointPath(
	nodeId: string,
	mountpointId: string,
	newPath: string
): void {
	nodeStore.update(nodeId, (data) => {
		if (data.type !== 'LOADER') return data;
		const loaderContent = data.content as import('$lib/types').LoaderContent;
		return {
			...data,
			content: loaderContent.updateMountpointPath(mountpointId, newPath)
		};
	});
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
	rdfStore: unknown | undefined,
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
		
		// Create PubChat and LLM module if config is provided
		let pubchat: PubChat | undefined;
		if (llmConfig && llmConfig.apiKey && llmConfig.model) {
			pubchat = new PubChat({
				llm: llmConfig,
				messageStore: new MemoryMessageStore(),
				toolCalling: { enabled: false }
			});
			jsModules.set('LLM', createLLMModule(pubchat));
		}
		
		// Register PubWiki module if context is provided
		if (pubwikiContext) {
			jsModules.set('pubwiki', createPubWikiModule(pubwikiContext));
		}
		
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
 * Find all asset VFS nodes connected to a Loader node via mountpoint handles
 * Returns a map of mount path -> VFS node ID
 */
export function findMountedVfsNodes(
	nodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[]
): Map<string, string> {
	const result = new Map<string, string>();
	
	// Get the Loader node's business data to look up mountpoint paths
	const loaderData = nodeStore.get(nodeId);
	if (!loaderData || loaderData.type !== 'LOADER') {
		return result;
	}
	const loaderContent = loaderData.content as import('$lib/types').LoaderContent;
	const mountpoints = loaderContent.mountpoints ?? [];
	
	// Find edges where this node is the target and handle is a loader mountpoint
	for (const edge of edges) {
		if (edge.target === nodeId && isLoaderMountpointHandle(edge.targetHandle)) {
			const mountpointId = getLoaderMountpointId(edge.targetHandle!);
			const mountpoint = mountpoints.find(mp => mp.id === mountpointId);
			if (!mountpoint) continue;
			
			const sourceNode = nodes.find(n => n.id === edge.source);
			if (!sourceNode) continue;
			
			const sourceData = nodeStore.get(sourceNode.id);
			if (sourceData?.type === 'VFS') {
				result.set(mountpoint.path, sourceNode.id);
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
// Event Handlers
// ============================================================================

/**
 * Handle connection to LOADER_ADD_MOUNT handle
 * Creates a new mountpoint and redirects the edge
 */
function handleAddMountConnection(event: ConnectionEvent): boolean {
	if (event.targetHandle !== HandleId.LOADER_ADD_MOUNT) {
		return false;
	}

	// Get existing mountpoints for validation from nodeStore
	const targetData = nodeStore.get(event.target);
	const existingMountpoints = targetData?.type === 'LOADER' 
		? (targetData.content as import('$lib/types').LoaderContent).mountpoints ?? []
		: [];

	// Use the initial placeholder path - user will edit it
	const newMountPath = INITIAL_MOUNTPOINT_PATH;
	
	// Validate before creating - check for duplicates
	const validationError = validateMountpointPath(newMountPath, existingMountpoints);
	if (validationError) {
		console.warn(`Cannot create mountpoint: ${validationError}`);
		return true; // Handled (but rejected) - prevent default edge creation
	}
	
	// Generate a stable ID for the new mountpoint
	const newMountpointId = generateMountpointId();
	const newMountpoint: Mountpoint = { id: newMountpointId, path: newMountPath };
	
	// Update the Loader node to add the new mountpoint via nodeStore
	nodeStore.update(event.target, (data) => {
		if (data.type !== 'LOADER') return data;
		const loaderContent = data.content as import('$lib/types').LoaderContent;
		return {
			...data,
			content: loaderContent.addMountpoint(newMountpoint)
		};
	});

	// Create edge to the new mountpoint handle (using stable ID)
	const newEdge: Edge = {
		id: `e-${event.source}-${event.target}-${newMountpointId}`,
		source: event.source,
		target: event.target,
		sourceHandle: event.sourceHandle ?? undefined,
		targetHandle: createLoaderMountpointHandleId(newMountpointId)
	};

	// Set editing mountpoint to focus the input
	editingMountpoint = { nodeId: event.target, mountpointId: newMountpointId };

	// Wait for the node to re-render with the new handle before adding the edge
	tick().then(() => {
		requestAnimationFrame(() => {
			event.updateEdges(edges => [
				...edges.filter(e => e.targetHandle !== HandleId.LOADER_ADD_MOUNT),
				newEdge
			]);
		});
	});

	return true; // Handled - prevent default edge creation
}

/**
 * Handle edge deletion for loader mountpoint edges
 * Removes the corresponding mountpoint from the Loader node
 */
function handleMountpointEdgeDelete(event: EdgeDeleteEvent): void {
	if (!isLoaderMountpointHandle(event.edge.targetHandle)) {
		return;
	}

	const mountpointId = getLoaderMountpointId(event.edge.targetHandle!);
	const targetNodeId = event.edge.target;

	// Remove the mountpoint from the Loader node via nodeStore
	nodeStore.update(targetNodeId, (data) => {
		if (data.type !== 'LOADER') return data;
		const loaderContent = data.content as import('$lib/types').LoaderContent;
		return {
			...data,
			content: loaderContent.removeMountpoint(mountpointId)
		};
	});
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
	/** Get service definition (for schema generation) */
	getServiceDefinition(identifier: string): Promise<ServiceDefinition | null>;
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
		getServiceDefinition: async (id) => {
			const services = await listServices(nodeId);
			return services.find(s => s.identifier === id) ?? null;
		}
	};
}

// ============================================================================
// Event Handler Registration
// ============================================================================

/**
 * Register Loader Node event handlers
 * Should be called once when the Studio component mounts
 */
export function registerLoaderNodeHandlers(): () => void {
	const unsubConnection = onConnection((event) => {
		return handleAddMountConnection(event);
	});
	
	const unsubEdgeDelete = onEdgeDelete((event) => {
		handleMountpointEdgeDelete(event);
	});
	
	return () => {
		unsubConnection();
		unsubEdgeDelete();
	};
}
