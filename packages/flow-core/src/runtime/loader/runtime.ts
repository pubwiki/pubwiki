/**
 * Loader Runtime
 * 
 * Backend factory registry and core loader initialization logic.
 * Extracted from Studio's LoaderNode controller — no Svelte, no hot-reload.
 * 
 * App layer injects concrete backend factories (LuaBackend, TsBackend)
 * so flow-core stays zero-WASM.
 */

import type {
	BackendType,
	BackendFactory,
	LoaderBackend,
	BackendConfig,
	BackendInitResult,
	RuntimeVfs,
	ServiceDefinition,
	ServiceCallResult,
	RpcStreamCallback,
} from '../types';

// ============================================================================
// Backend Registry
// ============================================================================

/**
 * Registry for backend factories.
 * 
 * App layers call `registerBackendFactory()` to register concrete
 * implementations (e.g. LuaBackend, TsBackend) before using the runtime.
 */
export class BackendRegistry {
	private factories = new Map<BackendType, BackendFactory>();

	register(type: BackendType, factory: BackendFactory): void {
		this.factories.set(type, factory);
	}

	create(type: BackendType): LoaderBackend | null {
		const factory = this.factories.get(type);
		return factory ? factory() : null;
	}

	has(type: BackendType): boolean {
		return this.factories.has(type);
	}
}

// ============================================================================
// Backend Detection
// ============================================================================

/**
 * Detect backend type from VFS file existence.
 * 
 * Detection order:
 * 1. index.ts → TypeScript backend (QuickJS)
 * 2. init.lua → Lua backend
 */
export async function detectBackendType(vfs: RuntimeVfs): Promise<BackendType> {
	if (await vfs.exists('/index.ts')) return 'ts';
	if (await vfs.exists('/init.lua')) return 'lua';
	return 'unknown';
}

/**
 * Create a backend by auto-detecting type from VFS.
 */
export async function createBackendFromVfs(
	registry: BackendRegistry,
	vfs: RuntimeVfs,
): Promise<LoaderBackend | null> {
	const type = await detectBackendType(vfs);
	return registry.create(type);
}

// ============================================================================
// Loader Backend Initialization (pure, no hot-reload)
// ============================================================================

/**
 * Initialize a loader backend with the given configuration.
 * 
 * This is the pure extraction of Studio's `initializeLoader()`,
 * without Svelte dependencies and VFS hot-reload wiring.
 * 
 * @param registry - Backend factory registry
 * @param config - Backend configuration (VFS, mounts, modules, etc.)
 * @returns The initialized backend and result, or an error
 */
export async function createLoaderBackend(
	registry: BackendRegistry,
	config: BackendConfig,
): Promise<{ backend: LoaderBackend; result: BackendInitResult } | { backend: null; result: BackendInitResult }> {
	const backend = await createBackendFromVfs(registry, config.backendVfs);

	if (!backend) {
		return {
			backend: null,
			result: {
				success: false,
				services: [],
				error: 'No supported backend found. Ensure init.lua or index.ts exists in the VFS.',
			},
		};
	}

	const result = await backend.initialize(config);
	if (!result.success) {
		return { backend: null, result };
	}

	return { backend, result };
}

// ============================================================================
// Loader Interface
// ============================================================================

/**
 * A thin façade over a LoaderBackend for sandbox-bridge consumption.
 * Mirrors Studio's `LoaderInterface` without Svelte coupling.
 */
export interface LoaderInterface {
	isReady(): boolean;
	listServices(): Promise<ServiceDefinition[]>;
	callService(identifier: string, inputs: Record<string, unknown>): Promise<ServiceCallResult>;
	streamService(
		identifier: string,
		inputs: Record<string, unknown>,
		on: RpcStreamCallback,
	): Promise<void>;
}

/**
 * Create a LoaderInterface wrapper around a LoaderBackend.
 */
export function createLoaderInterface(backend: LoaderBackend): LoaderInterface {
	return {
		isReady: () => backend.isReady(),
		listServices: () => backend.listServices(),
		callService: (id, inputs) => backend.callService(id, inputs),
		streamService: (id, inputs, on) => backend.streamService(id, inputs, on),
	};
}

// ============================================================================
// Service Factory Creation
// ============================================================================

/**
 * A factory function that creates a custom service bridge instance.
 */
export type CustomServiceFactory = () => {
	readonly serviceIdentifier: string;
	readonly isStreaming: boolean;
	call(inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
	stream(inputs: Record<string, unknown>, callback: RpcStreamCallback): Promise<void>;
	getDefinition(): ServiceDefinition;
	isReady(): boolean;
};

/**
 * Create service factories from a map of loader backends.
 * 
 * Each service registered in a backend's ServiceRegistry is exposed as a factory.
 * This is the pure extraction of Studio's `createLoaderServices()`.
 * 
 * @param backends - Map of loader node ID → backend instance
 * @returns Map of service identifier → factory function
 */
export async function createServiceFactories(
	backends: Map<string, LoaderBackend>,
): Promise<Map<string, CustomServiceFactory>> {
	const services = new Map<string, CustomServiceFactory>();

	for (const [, backend] of backends) {
		if (!backend.isReady()) continue;

		let definitions: ServiceDefinition[];
		try {
			definitions = await backend.listServices();
		} catch (e) {
			console.warn('[createServiceFactories] Failed to list services:', e);
			continue;
		}

		for (const def of definitions) {
			const isStreaming = def.isIterator ?? false;
			services.set(def.identifier, () => ({
				serviceIdentifier: def.identifier,
				isStreaming,
				async call(inputs: Record<string, unknown>) {
					if (isStreaming) {
						throw new Error(`Service ${def.identifier} is streaming. Use stream() instead.`);
					}
					const result = await backend.callService(def.identifier, inputs);
					if (!result.success) throw new Error(result.error ?? 'Service call failed');
					return result.outputs ?? {};
				},
				async stream(inputs: Record<string, unknown>, callback: RpcStreamCallback) {
					if (!isStreaming) {
						throw new Error(`Service ${def.identifier} is not streaming.`);
					}
					await backend.streamService(def.identifier, inputs, callback);
				},
				getDefinition() {
					return def;
				},
				isReady() {
					return backend.isReady();
				},
			}));
		}
	}

	return services;
}
