/**
 * LoaderNode Controller
 * 
 * Handles LoaderNode-specific logic:
 * - Lua VM initialization and lifecycle management
 * - Backend VFS connection handling
 * - Mountpoint management for asset VFS
 * - Service registration and calling
 */

import { tick } from 'svelte';
import { type Node, type Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	LoaderNodeData, 
	VFSNodeData,
	StateNodeData,
	Mountpoint
} from '../../../types';
import { 
	HandleId, 
	isLoaderMountpointHandle, 
	getLoaderMountpointId, 
	createLoaderMountpointHandleId,
	generateMountpointId
} from '../../../graph';
import { 
	onConnection, 
	onEdgeDelete,
	type ConnectionEvent,
	type EdgeDeleteEvent
} from '../../../state';
import { getNodeVfs } from '../../../vfs';
import { 
	createMountedVfs, 
	getMountedProvider, 
	createVfs,
	type Vfs, 
	type MountedVfsProvider,
	type VfsProvider,
	type VfsStat
} from '@pubwiki/vfs';
import { 
	loadRunner, 
	createLuaInstance, 
	type LuaInstance,
	type RDFStore,
	type JsModuleDefinition
} from '@pubwiki/lua';
import { 
	PubChat, 
	MemoryMessageStore,
	type LLMConfig,
	type ChatStreamEvent
} from '@pubwiki/chat';
import type { RpcStub, ServiceDefinition } from '@pubwiki/sandbox-host';

// Core Lua code (embedded)
import serviceLuaCode from '$lib/assets/lua/service.lua?raw';
import typesLuaCode from '$lib/assets/lua/types.lua?raw';

// ============================================================================
// MemoryVfsProvider - Simple in-memory VFS implementation
// ============================================================================

class MemoryVfsProvider implements VfsProvider {
	private files = new Map<string, Uint8Array>();
	private directories = new Set<string>(['/']);
	private encoder = new TextEncoder();

	private normalizePath(path: string): string {
		if (!path.startsWith('/')) path = '/' + path;
		if (path !== '/' && path.endsWith('/')) path = path.slice(0, -1);
		return path;
	}

	private getParentPath(path: string): string {
		const normalized = this.normalizePath(path);
		const lastSlash = normalized.lastIndexOf('/');
		if (lastSlash <= 0) return '/';
		return normalized.substring(0, lastSlash);
	}

	async id(path: string): Promise<string> {
		return this.normalizePath(path);
	}

	async readFile(path: string): Promise<Uint8Array> {
		const normalized = this.normalizePath(path);
		const content = this.files.get(normalized);
		if (!content) {
			throw new Error(`ENOENT: no such file: ${normalized}`);
		}
		return content;
	}

	async writeFile(path: string, content: Uint8Array): Promise<void> {
		const normalized = this.normalizePath(path);
		const parent = this.getParentPath(normalized);
		if (parent !== '/' && !this.directories.has(parent)) {
			await this.mkdir(parent, { recursive: true });
		}
		this.files.set(normalized, content);
	}

	async unlink(path: string): Promise<void> {
		const normalized = this.normalizePath(path);
		if (!this.files.has(normalized)) {
			throw new Error(`ENOENT: no such file: ${normalized}`);
		}
		this.files.delete(normalized);
	}

	async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
		const normalized = this.normalizePath(path);
		if (options?.recursive) {
			const parts = normalized.split('/').filter(Boolean);
			let current = '';
			for (const part of parts) {
				current += '/' + part;
				this.directories.add(current);
			}
		} else {
			this.directories.add(normalized);
		}
	}

	async readdir(path: string): Promise<string[]> {
		const normalized = this.normalizePath(path);
		const prefix = normalized === '/' ? '/' : normalized + '/';
		const entries = new Set<string>();

		for (const filePath of this.files.keys()) {
			if (filePath.startsWith(prefix)) {
				const relative = filePath.substring(prefix.length);
				const firstPart = relative.split('/')[0];
				if (firstPart) entries.add(firstPart);
			}
		}

		for (const dirPath of this.directories) {
			if (dirPath.startsWith(prefix) && dirPath !== normalized) {
				const relative = dirPath.substring(prefix.length);
				const firstPart = relative.split('/')[0];
				if (firstPart) entries.add(firstPart);
			}
		}

		return Array.from(entries).sort();
	}

	async rmdir(path: string): Promise<void> {
		const normalized = this.normalizePath(path);
		this.directories.delete(normalized);
	}

	async stat(path: string): Promise<VfsStat> {
		const normalized = this.normalizePath(path);
		const now = new Date();
		if (this.files.has(normalized)) {
			const content = this.files.get(normalized)!;
			return {
				isFile: true,
				isDirectory: false,
				size: content.length,
				createdAt: now,
				updatedAt: now
			};
		}
		if (this.directories.has(normalized)) {
			return {
				isFile: false,
				isDirectory: true,
				size: 0,
				createdAt: now,
				updatedAt: now
			};
		}
		throw new Error(`ENOENT: no such file or directory: ${normalized}`);
	}

	async exists(path: string): Promise<boolean> {
		const normalized = this.normalizePath(path);
		return this.files.has(normalized) || this.directories.has(normalized);
	}

	async rename(from: string, to: string): Promise<void> {
		const normalizedFrom = this.normalizePath(from);
		const normalizedTo = this.normalizePath(to);
		const content = this.files.get(normalizedFrom);
		if (content) {
			this.files.delete(normalizedFrom);
			this.files.set(normalizedTo, content);
		} else if (this.directories.has(normalizedFrom)) {
			this.directories.delete(normalizedFrom);
			this.directories.add(normalizedTo);
		} else {
			throw new Error(`ENOENT: no such file or directory: ${normalizedFrom}`);
		}
	}

	async copyFile(from: string, to: string): Promise<void> {
		const normalizedFrom = this.normalizePath(from);
		const normalizedTo = this.normalizePath(to);
		const content = this.files.get(normalizedFrom);
		if (!content) {
			throw new Error(`ENOENT: no such file: ${normalizedFrom}`);
		}
		await this.writeFile(normalizedTo, new Uint8Array(content));
	}

	// Helper to create a file with string content
	async createFile(path: string, content: string): Promise<void> {
		await this.writeFile(path, this.encoder.encode(content));
	}
}

/** Create a new in-memory VFS */
function createMemoryVfs(): Vfs<VfsProvider> {
	return createVfs(new MemoryVfsProvider());
}

// ============================================================================
// Types
// ============================================================================

/**
 * Loader Node runtime state (stored in memory, not persisted)
 */
interface LoaderRuntime {
	/** Lua VM instance */
	instance: LuaInstance;
	/** Mounted VFS */
	mountedVfs: Vfs<MountedVfsProvider>;
	/** PubChat instance for LLM access */
	pubchat?: PubChat;
}

/**
 * Service call result
 */
export interface ServiceCallResult {
	success: boolean;
	outputs?: Record<string, unknown>;
	error?: string;
}

// Note: ServiceDefinition is imported from @pubwiki/sandbox-host
// The Lua ServiceRegistry.export() returns this format with JSON Schema for inputs/outputs
export type { ServiceDefinition };

// Re-export LLMConfig for LoaderNode to use
export type { LLMConfig };

// ============================================================================
// LLM Module Factory
// ============================================================================

/**
 * Create a JS module definition for LLM access in Lua
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
		 * @param prompt User prompt
		 * @param historyId Optional history ID for conversation continuity
		 * @param overrideConfig Optional config overrides {model?, apiKey?, baseUrl?, temperature?, maxTokens?}
		 * @returns {content: string, historyId: string}
		 */
		async chat(prompt: string, historyId?: string, overrideConfig?: Partial<LLMConfig>) {
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
		 * @param prompt User prompt
		 * @param historyId Optional history ID for conversation continuity
		 * @param overrideConfig Optional config overrides
		 * @returns Async iterator yielding {type: string, ...data}
		 */
		stream(prompt: string, historyId?: string, overrideConfig?: Partial<LLMConfig>) {
			// Return an async iterator that Lua can consume
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
// State
// ============================================================================

/** Runtime state storage (nodeId -> runtime) */
const loaderRuntimes = new Map<string, LoaderRuntime>();

/** Currently editing mountpoint (node-local state, exposed for UI) */
let editingMountpoint: { nodeId: string; mountpointId: string } | null = $state(null);

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
	newPath: string,
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void
): void {
	updateNodes(nodes => nodes.map(n => {
		if (n.id === nodeId && n.data.type === 'LOADER') {
			const loaderData = n.data as LoaderNodeData;
			return {
				...n,
				data: {
					...loaderData,
					content: loaderData.content.updateMountpointPath(mountpointId, newPath)
				}
			};
		}
		return n;
	}));
}

// ============================================================================
// Public API - Lua VM Management
// ============================================================================

/**
 * Initialize Loader Node's Lua VM
 * 
 * @param nodeId - The node ID
 * @param backendVfs - Backend VFS instance
 * @param assetMounts - Map of mount paths to VFS instances
 * @param rdfStore - Optional RDF store for State API
 * @param llmConfig - LLM configuration from user settings (apiKey, model, baseUrl)
 * @param updateNode - Node update callback
 */
export async function initializeLoader(
	nodeId: string,
	backendVfs: Vfs<VfsProvider>,
	assetMounts: Map<string, Vfs<VfsProvider>>,
	rdfStore: RDFStore | undefined,
	llmConfig: LLMConfig | undefined,
	updateNode: (id: string, updater: (data: LoaderNodeData) => LoaderNodeData) => void
): Promise<boolean> {
	try {
		// Clean up existing runtime if any
		const existingRuntime = loaderRuntimes.get(nodeId);
		if (existingRuntime) {
			existingRuntime.instance.destroy();
			loaderRuntimes.delete(nodeId);
		}
		
		updateNode(nodeId, (data) => ({ ...data, error: null }));
		
		// Ensure Lua runtime is loaded
		await loadRunner();
		
		// Create mounted VFS
		const mountedVfs = createMountedVfs();
		const provider = getMountedProvider(mountedVfs);
		
		if (!provider) {
			throw new Error('Failed to get MountedVfsProvider');
		}
		
		// Create memory VFS for core libraries
		const coreVfs = createMemoryVfs();
		await coreVfs.createFile('/service.lua', serviceLuaCode);
		await coreVfs.createFile('/types.lua', typesLuaCode);
		provider.mount('/core', coreVfs);
		
		// Mount backend VFS
		provider.mount('/user/backend', backendVfs);
		
		// Mount asset VFS
		for (const [path, vfs] of assetMounts) {
			provider.mount(`/user/assets${path}`, vfs);
		}
		
		// Create Lua instance with RDF store if provided
		const instance = createLuaInstance({
			vfs: mountedVfs,
			workingDirectory: '/',
			rdfStore: rdfStore
		});
		
		// Create PubChat instance and register LLM module if config is provided
		let pubchat: PubChat | undefined;
		if (llmConfig && llmConfig.apiKey && llmConfig.model) {
			pubchat = new PubChat({
				llm: llmConfig,
				messageStore: new MemoryMessageStore(),
				toolCalling: { enabled: false }
			});
			instance.registerJsModule('LLM', createLLMModule(pubchat));
		}
		
		// Execute init.lua
		const initResult = await instance.run(`
			-- Load init.lua
			local init = require("user/backend/init")
			
			-- Return registered services list
			local ServiceRegistry = require("core/service")
			return ServiceRegistry.listServices()
		`);
		
		if (initResult.error) {
			throw new Error(initResult.error);
		}
		
		// Store runtime state
		loaderRuntimes.set(nodeId, { instance, mountedVfs, pubchat });
		
		// Update node state
		// Lua tables with numeric keys are converted to objects like {1: "a", 2: "b"}, not arrays
		let services: string[];
		if (Array.isArray(initResult.result)) {
			services = initResult.result;
		} else if (initResult.result && typeof initResult.result === 'object') {
			// Convert Lua table (object with numeric keys) to array
			services = Object.values(initResult.result as Record<string, string>);
		} else {
			services = [];
		}
		
		updateNode(nodeId, (data) => ({
			...data,
			error: null,
			registeredServices: services
		}));
		
		return true;
	} catch (error) {
		updateNode(nodeId, (data) => ({
			...data,
			error: error instanceof Error ? error.message : String(error),
			registeredServices: []
		}));
		return false;
	}
}

/**
 * Destroy Loader Node's Lua VM
 */
export async function destroyLoader(
	nodeId: string,
	updateNode: (id: string, updater: (data: LoaderNodeData) => LoaderNodeData) => void
): Promise<void> {
	const runtime = loaderRuntimes.get(nodeId);
	if (runtime) {
		runtime.instance.destroy();
		loaderRuntimes.delete(nodeId);
	}
	
	updateNode(nodeId, (data) => ({
		...data,
		error: null,
		registeredServices: []
	}));
}

/**
 * Check if Loader Node is ready
 */
export function isLoaderReady(nodeId: string): boolean {
	return loaderRuntimes.has(nodeId);
}

/**
 * List services from Loader Node
 */
export async function listServices(nodeId: string): Promise<ServiceDefinition[]> {
	const runtime = loaderRuntimes.get(nodeId);
	if (!runtime) {
		throw new Error('Loader not initialized');
	}
	
	const result = await runtime.instance.run(`
		local ServiceRegistry = require("core/service")
		return ServiceRegistry.export()
	`);
	
	if (result.error) {
		throw new Error(result.error);
	}
	
	// Convert to array format
	const servicesMap = result.result as Record<string, ServiceDefinition>;
	return Object.values(servicesMap);
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
	
	// Serialize inputs to JSON
	const inputsJson = JSON.stringify(inputs);
	
	const result = await runtime.instance.run(`
		local ServiceRegistry = require("core/service")
		
		local inputs = json.decode([[${inputsJson}]])
		local outputs = ServiceRegistry.call("${identifier}", inputs)
		
		return outputs
	`);
	
	if (result.error) {
		return { success: false, error: result.error };
	}
	
	const outputs = result.result as Record<string, unknown>;
	if (outputs && outputs._error) {
		return { success: false, error: outputs._error as string };
	}
	
	return { success: true, outputs };
}

/**
 * Call a streaming service on Loader Node
 * 
 * For services that return an iterator, this function iterates over all values
 * and invokes the callback for each yielded value.
 * 
 * @param nodeId - The Loader node ID
 * @param identifier - Service identifier (namespace:name)
 * @param inputs - Input parameters for the service
 * @param on - Callback invoked for each yielded value
 * @returns ServiceCallResult indicating success/failure
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
	
	// Serialize inputs to JSON
	const inputsJson = JSON.stringify(inputs);
	
	// Run service and get iterator
	const iter = runtime.instance.runIter(`
		local ServiceRegistry = require("core/service")
		local inputs = json.decode([[${inputsJson}]])
		local iterator = ServiceRegistry.call("${identifier}", inputs)
		-- If returned value is an iterator function, wrap it for Lua iteration
		if type(iterator) == "function" then
			return function()
				local value = iterator()
				return value
			end
		end
		-- Otherwise wrap as single-value iterator
		local called = false
		return function()
			if called then return nil end
			called = true
			return iterator
		end
	`);
	
	for await (const values of iter) {
		// Lua iterator returns array of values, we take the first one
		const value = Array.isArray(values) && values.length > 0 ? values[0] : values;
		// Stop iteration if value is null/undefined (end of stream)
		if (value === null || value === undefined) {
			break;
		}
		await on(value);
	}
}

// ============================================================================
// Connection Helpers
// ============================================================================

/**
 * Find the backend VFS node connected to a Loader node
 */
export function findBackendVfsNode(
	nodeId: string,
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Node<VFSNodeData> | null {
	const backendEdge = edges.find(
		e => e.target === nodeId && e.targetHandle === HandleId.LOADER_BACKEND
	);
	
	if (!backendEdge) return null;
	
	const sourceNode = nodes.find(n => n.id === backendEdge.source);
	if (sourceNode?.data.type === 'VFS') {
		return sourceNode as Node<VFSNodeData>;
	}
	
	return null;
}

/**
 * Find all asset VFS nodes connected to a Loader node via mountpoint handles
 * Returns a map of mount path -> VFS node
 */
export function findMountedVfsNodes(
	nodeId: string,
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Map<string, Node<VFSNodeData>> {
	const result = new Map<string, Node<VFSNodeData>>();
	
	// Get the Loader node to look up mountpoint paths
	const loaderNode = nodes.find(n => n.id === nodeId);
	if (!loaderNode || loaderNode.data.type !== 'LOADER') {
		return result;
	}
	const loaderData = loaderNode.data as LoaderNodeData;
	const mountpoints = loaderData.content.mountpoints ?? [];
	
	// Find edges where this node is the target and handle is a loader mountpoint
	for (const edge of edges) {
		if (edge.target === nodeId && isLoaderMountpointHandle(edge.targetHandle)) {
			const mountpointId = getLoaderMountpointId(edge.targetHandle!);
			const mountpoint = mountpoints.find(mp => mp.id === mountpointId);
			if (!mountpoint) continue;
			
			const sourceNode = nodes.find(n => n.id === edge.source);
			if (sourceNode?.data.type === 'VFS') {
				result.set(mountpoint.path, sourceNode as Node<VFSNodeData>);
			}
		}
	}
	
	return result;
}

/**
 * Find the State node connected to a Loader node via the state handle
 */
export function findStateNode(
	nodeId: string,
	nodes: Node<StudioNodeData>[],
	edges: Edge[]
): Node<StateNodeData> | null {
	const stateEdge = edges.find(
		e => e.target === nodeId && e.targetHandle === HandleId.LOADER_STATE
	);
	
	if (!stateEdge) return null;
	
	const sourceNode = nodes.find(n => n.id === stateEdge.source);
	if (sourceNode?.data.type === 'STATE') {
		return sourceNode as Node<StateNodeData>;
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

	// Get existing mountpoints for validation
	const targetNode = event.nodes.find(n => n.id === event.target);
	const existingMountpoints = targetNode?.data.type === 'LOADER' 
		? (targetNode.data as LoaderNodeData).content.mountpoints ?? []
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
	
	// Update the Loader node to add the new mountpoint
	event.updateNodes(nodes => nodes.map(n => {
		if (n.id === event.target && n.data.type === 'LOADER') {
			const data = n.data as LoaderNodeData;
			return {
				...n,
				data: {
					...data,
					content: data.content.addMountpoint(newMountpoint)
				}
			};
		}
		return n;
	}));

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

	// Remove the mountpoint from the Loader node
	event.updateNodes(nodes => nodes.map(n => {
		if (n.id === targetNodeId && n.data.type === 'LOADER') {
			const loaderData = n.data as LoaderNodeData;
			return {
				...n,
				data: {
					...loaderData,
					content: loaderData.content.removeMountpoint(mountpointId)
				}
			};
		}
		return n;
	}));
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
