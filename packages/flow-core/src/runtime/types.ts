/**
 * Runtime Types
 * 
 * Core types for the flow graph runtime execution engine.
 * RuntimeGraph is the single source of truth for both Player and Studio.
 */

import type { NodeType, NodeContent } from '../types';
import type { EntrypointConfig } from '../validation';
import type { JsModuleDefinition } from '@pubwiki/lua';

// Re-export for runtime consumers
export type { EntrypointConfig, JsModuleDefinition };

// ============================================================================
// Runtime Graph
// ============================================================================

/**
 * Runtime graph representation — carries content data + runtime state.
 * Unlike ImmutableGraph (validation-only), RuntimeGraph has resolved content objects.
 */
export interface RuntimeGraph {
	nodes: Map<string, RuntimeNode>;
	edges: RuntimeEdge[];
	entrypoint: EntrypointConfig | null;
	buildCacheKey: string | null;
}

/**
 * A node in the runtime graph.
 */
export interface RuntimeNode {
	id: string;
	type: NodeType;
	name: string;
	content: NodeContent;
	commit: string;
	contentHash: string;
}

/**
 * An edge in the runtime graph.
 */
export interface RuntimeEdge {
	source: string;
	target: string;
	sourceHandle: string;
	targetHandle: string;
}

// ============================================================================
// Loader Backend Interface (extracted from Studio)
// ============================================================================

/**
 * JS module register mode.
 */
export type JsModuleMode = 'module' | 'global' | 'patch';

/**
 * JS module entry with registration options.
 */
export interface JsModuleEntry {
	module: JsModuleDefinition;
	mode?: JsModuleMode;
}

/**
 * JS module registry — name to module entry.
 */
export type JsModuleRegistry = Map<string, JsModuleEntry>;

// ============================================================================
// Backend Configuration
// ============================================================================

/**
 * Minimal VFS interface required by the runtime.
 * This avoids a hard dependency on @pubwiki/vfs.
 */
export interface RuntimeVfs {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<ArrayBuffer>;
	writeFile(path: string, data: ArrayBuffer): Promise<void>;
	readdir(path: string): Promise<string[]>;
	dispose(): void;
	events: {
		onAny(handler: (event: { type: string }) => void): () => void;
	};
}

/**
 * Configuration for initializing a loader backend.
 */
export interface BackendConfig {
	backendVfs: RuntimeVfs;
	assetMounts: Map<string, RuntimeVfs>;
	rdfStore?: RDFStoreRef;
	llmConfig?: LLMConfigRef;
	jsModules?: JsModuleRegistry;
}

/**
 * Opaque reference to an RDF store — avoids hard dep on @pubwiki/rdfstore.
 */
export type RDFStoreRef = unknown;

/**
 * Opaque reference to LLM config — avoids hard dep on @pubwiki/chat.
 */
export type LLMConfigRef = unknown;

// ============================================================================
// Backend Results
// ============================================================================

/**
 * Result from backend initialization.
 */
export interface BackendInitResult {
	success: boolean;
	services: string[];
	error: string | null;
}

/**
 * Result from a service call.
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
 * Service definition from a backend (JSON Schema based).
 */
export interface ServiceDefinition {
	identifier: string;
	description?: string;
	inputs?: Record<string, unknown>;
	outputs?: Record<string, unknown>;
	isIterator?: boolean;
}

/**
 * RPC stub type for streaming callbacks.
 */
export type RpcStreamCallback = (value: unknown) => Promise<void> | void;

/**
 * Abstract interface for loader backends.
 * 
 * Implementations (LuaBackend, TsBackend) are injected by app layer.
 * flow-core itself remains zero-WASM.
 */
export interface LoaderBackend {
	readonly type: string;
	initialize(config: BackendConfig): Promise<BackendInitResult>;
	reload(): Promise<BackendInitResult>;
	destroy(): Promise<void>;
	isReady(): boolean;
	registerJsModule(name: string, module: JsModuleDefinition): void;
	listServices(): Promise<ServiceDefinition[]>;
	callService(
		identifier: string,
		inputs: Record<string, unknown>
	): Promise<ServiceCallResult>;
	streamService(
		identifier: string,
		inputs: Record<string, unknown>,
		on: RpcStreamCallback
	): Promise<void>;
}

// ============================================================================
// Backend Factory & Registry
// ============================================================================

/**
 * Backend type identifier.
 */
export type BackendType = 'lua' | 'ts' | 'unknown';

/**
 * Factory function for creating backend instances.
 */
export type BackendFactory = () => LoaderBackend;

// ============================================================================
// Confirmation Handler (UI injection interface)
// ============================================================================

/**
 * UI-injectable confirmation handler.
 * Studio injects Svelte dialogs; Player injects its own UI.
 */
export interface ConfirmationHandler {
	confirm<T extends Record<string, unknown>>(
		action: string,
		initialValues: T
	): Promise<T | null>;
}

// ============================================================================
// Artifact Context (for cloud saves)
// ============================================================================

/**
 * Context information for a published artifact.
 */
export interface ArtifactContext {
	isPublished: boolean;
	artifactId?: string;
	artifactCommit?: string;
}

// ============================================================================
// Entry Node Discovery Result
// ============================================================================

/**
 * Result of discovering entry nodes from the runtime graph.
 */
export interface EntryNodeDiscovery {
	sandboxNode: RuntimeNode;
	vfsNodes: RuntimeNode[];
	loaderNodes: RuntimeNode[];
	stateNode: RuntimeNode | null;
}
