/**
 * Loader Backend Abstraction Types
 * 
 * Defines the interface for different backend implementations (Lua, WASM, JS, etc.)
 * Backend selection is based on file existence in VFS (e.g., init.lua -> LuaBackend)
 */

import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import type { RpcStub, ServiceDefinition } from '@pubwiki/sandbox-host';
import type { LLMConfig } from '@pubwiki/chat';
import type { RDFStore, JsModuleDefinition } from '@pubwiki/lua';

// Re-export for convenience
export type { ServiceDefinition, LLMConfig, RDFStore, JsModuleDefinition };

// ============================================================================
// JS Module Registration (shared across all backends)
// ============================================================================

/**
 * JS module registry - name to module definition
 */
export type JsModuleRegistry = Map<string, JsModuleDefinition>;

// ============================================================================
// Backend Configuration
// ============================================================================

/**
 * Configuration for initializing a loader backend
 */
export interface BackendConfig {
	/** Backend VFS (source of code/scripts) */
	backendVfs: Vfs<VfsProvider>;
	/** Asset mountpoints: path -> VFS */
	assetMounts: Map<string, Vfs<VfsProvider>>;
	/** RDF store for state management (optional) */
	rdfStore?: RDFStore;
	/** LLM configuration (optional) */
	llmConfig?: LLMConfig;
	/** JS modules to register with the backend */
	jsModules?: JsModuleRegistry;
}

// ============================================================================
// Backend Results
// ============================================================================

/**
 * Result from backend initialization
 */
export interface BackendInitResult {
	success: boolean;
	/** List of registered service identifiers */
	services: string[];
	/** Error message if initialization failed */
	error: string | null;
}

/**
 * Result from a service call
 */
export interface ServiceCallResult {
	success: boolean;
	outputs?: Record<string, unknown>;
	error?: string;
}

// ============================================================================
// Loader Backend Interface
// ============================================================================

/**
 * Abstract interface for loader backends
 * 
 * Implementations:
 * - LuaBackend: Lua VM via @pubwiki/lua
 * - (Future) WasmBackend: WASM modules
 * - (Future) JsBackend: JavaScript/TypeScript
 */
export interface LoaderBackend {
	/** Backend type identifier */
	readonly type: string;

	/**
	 * Initialize the backend with the given configuration
	 * @param config Backend configuration
	 * @returns Initialization result with service list or error
	 */
	initialize(config: BackendConfig): Promise<BackendInitResult>;

	/**
	 * Destroy the backend and release resources
	 */
	destroy(): Promise<void>;

	/**
	 * Check if the backend is ready to handle service calls
	 */
	isReady(): boolean;

	/**
	 * Register a JS module with the backend
	 * @param name Module name (accessible in backend code)
	 * @param module Module definition with functions
	 */
	registerJsModule(name: string, module: JsModuleDefinition): void;

	/**
	 * List all registered services with their definitions
	 */
	listServices(): Promise<ServiceDefinition[]>;

	/**
	 * Call a service (non-streaming)
	 * @param identifier Service identifier (namespace:name)
	 * @param inputs Input parameters
	 */
	callService(
		identifier: string,
		inputs: Record<string, unknown>
	): Promise<ServiceCallResult>;

	/**
	 * Call a streaming service
	 * @param identifier Service identifier (namespace:name)
	 * @param inputs Input parameters
	 * @param on Callback invoked for each yielded value
	 */
	streamService(
		identifier: string,
		inputs: Record<string, unknown>,
		on: RpcStub<(value: unknown) => Promise<void> | void>
	): Promise<void>;
}

// ============================================================================
// Backend Detection
// ============================================================================

/**
 * Backend type enum
 */
export type BackendType = 'lua' | 'unknown';

/**
 * Detect backend type based on files in VFS
 * @param vfs VFS to check for entry point files
 * @returns Detected backend type
 */
export async function detectBackendType(vfs: Vfs<VfsProvider>): Promise<BackendType> {
	// Check for Lua backend (init.lua)
	if (await vfs.exists('/init.lua')) {
		return 'lua';
	}
	
	// Future: Check for other backends
	// if (await vfs.exists('/init.wasm')) return 'wasm';
	// if (await vfs.exists('/init.js')) return 'js';
	
	return 'unknown';
}

// ============================================================================
// Backend Factory
// ============================================================================

/**
 * Factory function type for creating backend instances
 */
export type BackendFactory = () => LoaderBackend;

/**
 * Registry of backend factories by type
 */
const backendFactories = new Map<BackendType, BackendFactory>();

/**
 * Register a backend factory
 * @param type Backend type
 * @param factory Factory function
 */
export function registerBackendFactory(type: BackendType, factory: BackendFactory): void {
	backendFactories.set(type, factory);
}

/**
 * Create a backend instance by type
 * @param type Backend type
 * @returns Backend instance or null if type not registered
 */
export function createBackend(type: BackendType): LoaderBackend | null {
	const factory = backendFactories.get(type);
	return factory ? factory() : null;
}

/**
 * Create a backend instance by auto-detecting from VFS
 * @param vfs VFS to check for entry point files
 * @returns Backend instance or null if no matching backend found
 */
export async function createBackendFromVfs(vfs: Vfs<VfsProvider>): Promise<LoaderBackend | null> {
	const type = await detectBackendType(vfs);
	return createBackend(type);
}
