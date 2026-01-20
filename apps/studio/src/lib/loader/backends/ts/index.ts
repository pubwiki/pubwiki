/**
 * TypeScript Backend Implementation
 * 
 * Implements LoaderBackend using QuickJS (via quickjs-emscripten) for JavaScript execution.
 * TypeScript code is first bundled to JavaScript using @pubwiki/bundler,
 * then executed in QuickJS sandbox.
 * 
 * Detected when index.ts exists in the backend VFS.
 * 
 * Features:
 * - Asyncify support for async/await in synchronous contexts
 * - Full ES module support
 * - JS module registration for host functions
 * - No manual type system needed (uses TypeScript's type system)
 */

import { newQuickJSAsyncWASMModuleFromVariant } from 'quickjs-emscripten-core';
import RELEASE_ASYNCIFY from '@jitl/quickjs-wasmfile-release-asyncify';
import type {
	QuickJSAsyncWASMModule,
	QuickJSAsyncRuntime,
	QuickJSAsyncContext,
	QuickJSHandle
} from 'quickjs-emscripten-core';
import { createBundler, type BundlerService } from '@pubwiki/bundler';
import type { Vfs, VfsProvider } from '@pubwiki/vfs';
import type { ServiceDefinition, RpcStub } from '@pubwiki/sandbox-host';

import type {
	LoaderBackend,
	BackendConfig,
	BackendInitResult,
	ServiceCallResult,
	JsModuleDefinition
} from '../../types';
import { registerBackendFactory } from '../../types';

// ============================================================================
// Service Runtime Interface (defined in user code)
// ============================================================================

/**
 * Expected exports from index.ts:
 * 
 * ```typescript
 * // Service definition
 * export interface Service {
 *   identifier: string;
 *   name: string;
 *   namespace: string;
 *   description?: string;
 *   kind: 'ACTION' | 'PURE';
 *   inputs: Record<string, unknown>;  // JSON Schema
 *   outputs: Record<string, unknown>; // JSON Schema
 * }
 * 
 * // Register services
 * export const services: Service[];
 * 
 * // Service implementations (called by identifier)
 * export function call(identifier: string, inputs: Record<string, unknown>): unknown;
 * 
 * // Optional: streaming service
 * export async function* stream(identifier: string, inputs: Record<string, unknown>): AsyncGenerator<unknown>;
 * ```
 */

// ============================================================================
// TsBackend Implementation
// ============================================================================

/**
 * TypeScript Backend using QuickJS with Asyncify
 */
export class TsBackend implements LoaderBackend {
	readonly type = 'ts';

	private module: QuickJSAsyncWASMModule | null = null;
	private runtime: QuickJSAsyncRuntime | null = null;
	private context: QuickJSAsyncContext | null = null;
	private bundler: BundlerService | null = null;
	private ready = false;

	// Registered JS modules (before initialization)
	private pendingModules = new Map<string, JsModuleDefinition>();

	// Cached service list
	private cachedServices: ServiceDefinition[] = [];
	
	/** Stored config for reload */
	private currentConfig: BackendConfig | null = null;

	// ========================================================================
	// LoaderBackend Interface
	// ========================================================================

	async initialize(config: BackendConfig): Promise<BackendInitResult> {
		try {
			// Clean up any existing instance
			await this.destroy();
			
			// Store config for reload
			this.currentConfig = config;

			// Create bundler for TypeScript compilation
			this.bundler = await createBundler({ vfs: config.backendVfs });

			// Initialize QuickJS with Asyncify support using the variant
			this.module = await newQuickJSAsyncWASMModuleFromVariant(RELEASE_ASYNCIFY);

			// Bundle and execute
			return await this.bundleAndExecute();
		} catch (error) {
			this.ready = false;
			return {
				success: false,
				services: [],
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	async reload(): Promise<BackendInitResult> {
		if (!this.currentConfig || !this.bundler || !this.module) {
			return {
				success: false,
				services: [],
				error: 'Cannot reload: backend was never initialized'
			};
		}
		
		console.log('[TsBackend] Reloading (preserving bundler cache)...');
		
		try {
			// Dispose old context and runtime, but keep module and bundler
			if (this.context) {
				this.context.dispose();
				this.context = null;
			}
			if (this.runtime) {
				this.runtime.dispose();
				this.runtime = null;
			}
			this.ready = false;
			this.cachedServices = [];

			// Re-bundle and execute
			return await this.bundleAndExecute();
		} catch (error) {
			this.ready = false;
			return {
				success: false,
				services: [],
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Bundle TypeScript code and execute in QuickJS context
	 * Shared logic between initialize and reload
	 */
	private async bundleAndExecute(): Promise<BackendInitResult> {
		if (!this.bundler || !this.module || !this.currentConfig) {
			throw new Error('Backend not properly initialized');
		}

		// Bundle the TypeScript code
		const bundleResult = await this.bundler.buildEntries({
			projectRoot: '/',
			entryFiles: ['/index.ts'],
			options: {
				format: 'esm',
				target: 'es2020',
				minify: false
			}
		});

		if (!bundleResult.success) {
			const errors = Array.from(bundleResult.outputs.values())
				.flatMap(o => o.errors ?? [])
				.map(e => typeof e === 'string' ? e : e.message)
				.join('\n');
			throw new Error(`Failed to bundle TypeScript: ${errors || 'Unknown error'}`);
		}

		// Get the bundled code
		const output = bundleResult.outputs.get('/index.ts');
		if (!output?.code) {
			const keys = Array.from(bundleResult.outputs.keys());
			throw new Error(`No output generated from bundler. Available outputs: ${keys.join(', ') || 'none'}`);
		}
		const bundledCode = output.code;

		// Create runtime and context
		this.runtime = this.module.newRuntime();
		this.context = this.runtime.newContext();

		// Set up memory limits
		this.runtime.setMemoryLimit(1024 * 1024 * 64); // 64MB
		this.runtime.setMaxStackSize(1024 * 1024); // 1MB stack

		// Register JS modules
		if (this.currentConfig.jsModules) {
			for (const [name, module] of this.currentConfig.jsModules) {
				this.registerJsModuleInternal(name, module);
			}
		}
		for (const [name, module] of this.pendingModules) {
			this.registerJsModuleInternal(name, module);
		}
		this.pendingModules.clear();

		// Evaluate the bundled code as ES module
		const result = await this.context.evalCodeAsync(bundledCode, 'index.js', {
			type: 'module'
		});

		if (result.error) {
			const errorMessage = this.context.dump(result.error);
			result.error.dispose();
			throw new Error(`Failed to execute module: ${JSON.stringify(errorMessage)}`);
		}

		// Get exports from the module
		const exports = result.value;

		// Get services array from exports
		const servicesHandle = this.context.getProp(exports, 'services');
		if (servicesHandle) {
			const servicesValue = this.context.dump(servicesHandle);
			servicesHandle.dispose();
			
			if (Array.isArray(servicesValue)) {
				this.cachedServices = servicesValue.map(s => ({
					identifier: s.identifier,
					name: s.name,
					namespace: s.namespace,
					description: s.description,
					kind: s.kind,
					inputs: s.inputs,
					outputs: s.outputs
				}));
			}
		}

		exports.dispose();
		this.ready = true;

		return {
			success: true,
			services: this.cachedServices.map(s => s.identifier),
			error: null
		};
	}

	async destroy(): Promise<void> {
		if (this.context) {
			this.context.dispose();
			this.context = null;
		}
		if (this.runtime) {
			this.runtime.dispose();
			this.runtime = null;
		}
		// QuickJSAsyncWASMModule doesn't need dispose
		this.module = null;
		this.bundler = null;
		this.ready = false;
		this.cachedServices = [];
		// Don't clear currentConfig - needed for reload after destroy
	}

	isReady(): boolean {
		return this.ready && this.context !== null;
	}

	registerJsModule(name: string, module: JsModuleDefinition): void {
		if (this.context) {
			this.registerJsModuleInternal(name, module);
		} else {
			// Store for later registration
			this.pendingModules.set(name, module);
		}
	}

	async listServices(): Promise<ServiceDefinition[]> {
		if (!this.context) {
			throw new Error('TypeScript backend not initialized');
		}
		return this.cachedServices;
	}

	async callService(
		identifier: string,
		inputs: Record<string, unknown>
	): Promise<ServiceCallResult> {
		if (!this.context) {
			return { success: false, error: 'TypeScript backend not initialized' };
		}

		try {
			// Call the exported 'call' function
			const code = `
				import { call } from './index.js';
				globalThis.__callResult = call(${JSON.stringify(identifier)}, ${JSON.stringify(inputs)});
			`;

			const result = await this.context.evalCodeAsync(code, 'call.js', { type: 'module' });
			
			if (result.error) {
				const errorMessage = this.context.dump(result.error);
				result.error.dispose();
				return { success: false, error: JSON.stringify(errorMessage) };
			}
			result.value.dispose();

			// Get result from global
			const resultHandle = this.context.getProp(this.context.global, '__callResult');
			
			// Handle promise result
			const promiseState = this.context.getPromiseState(resultHandle);
			let outputs: Record<string, unknown>;
			
			if (promiseState.type === 'pending') {
				// Wait for promise to resolve
				const resolved = await this.context.resolvePromise(resultHandle);
				resultHandle.dispose();
				
				if (resolved.error) {
					const errorMessage = this.context.dump(resolved.error);
					resolved.error.dispose();
					return { success: false, error: JSON.stringify(errorMessage) };
				}
				
				outputs = this.context.dump(resolved.value) as Record<string, unknown>;
				resolved.value.dispose();
			} else if (promiseState.type === 'fulfilled') {
				outputs = this.context.dump(promiseState.value) as Record<string, unknown>;
				promiseState.value.dispose();
				resultHandle.dispose();
			} else {
				// Rejected
				const errorMessage = this.context.dump(promiseState.error);
				promiseState.error.dispose();
				resultHandle.dispose();
				return { success: false, error: JSON.stringify(errorMessage) };
			}

			if (outputs && typeof outputs === 'object' && '_error' in outputs) {
				return { success: false, error: outputs._error as string };
			}

			return { success: true, outputs };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	async streamService(
		identifier: string,
		inputs: Record<string, unknown>,
		on: RpcStub<(value: unknown) => Promise<void> | void>
	): Promise<void> {
		if (!this.context) {
			throw new Error('TypeScript backend not initialized');
		}

		try {
			// Expose callback to QuickJS
			const callbackHandle = this.context.newFunction('__streamCallback', (valueHandle) => {
				const value = this.context!.dump(valueHandle);
				on(value);
			});
			this.context.setProp(this.context.global, '__streamCallback', callbackHandle);
			callbackHandle.dispose();

			// Call the exported 'stream' function and iterate
			const code = `
				(async () => {
					const { stream } = await import('./index.js');
					const iterator = stream(${JSON.stringify(identifier)}, ${JSON.stringify(inputs)});
					
					if (iterator && typeof iterator[Symbol.asyncIterator] === 'function') {
						for await (const value of iterator) {
							if (value === undefined) break;
							__streamCallback(value);
						}
					} else if (iterator !== undefined) {
						// Single value
						__streamCallback(iterator);
					}
				})()
			`;

			const result = await this.context.evalCodeAsync(code, 'stream.js', { type: 'module' });
			
			if (result.error) {
				const errorMessage = this.context.dump(result.error);
				result.error.dispose();
				throw new Error(JSON.stringify(errorMessage));
			}

			// Wait for the async function to complete
			const promiseHandle = result.value;
			const resolved = await this.context.resolvePromise(promiseHandle);
			promiseHandle.dispose();

			if (resolved.error) {
				const errorMessage = this.context.dump(resolved.error);
				resolved.error.dispose();
				throw new Error(JSON.stringify(errorMessage));
			}
			resolved.value.dispose();
		} catch (error) {
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	// ========================================================================
	// Private Methods
	// ========================================================================

	/**
	 * Register a JS module with the QuickJS context
	 */
	private registerJsModuleInternal(name: string, module: JsModuleDefinition): void {
		if (!this.context) return;

		// Create module object
		const moduleObj = this.context.newObject();

		for (const [funcName, func] of Object.entries(module)) {
			if (typeof func !== 'function') continue;

			// Create async-capable function
			const funcHandle = this.context.newAsyncifiedFunction(funcName, async (...args) => {
				// Convert QuickJS handles to JS values
				const jsArgs = args.map(arg => this.context!.dump(arg));
				
				try {
					// Call the host function
					const result = await Promise.resolve(func(...jsArgs));
					
					// Convert result back to QuickJS handle
					return this.jsToHandle(result);
				} catch (error) {
					throw error;
				}
			});

			this.context.setProp(moduleObj, funcName, funcHandle);
			funcHandle.dispose();
		}

		// Set module as global
		this.context.setProp(this.context.global, name, moduleObj);
		moduleObj.dispose();
	}

	/**
	 * Convert a JavaScript value to a QuickJS handle
	 */
	private jsToHandle(value: unknown): QuickJSHandle {
		if (!this.context) {
			throw new Error('Context not initialized');
		}

		if (value === null || value === undefined) {
			return this.context.undefined;
		}

		switch (typeof value) {
			case 'boolean':
				return value ? this.context.true : this.context.false;
			case 'number':
				return this.context.newNumber(value);
			case 'string':
				return this.context.newString(value);
			case 'function': {
				// Wrap JS function as QuickJS async function
				const fn = value as (...args: unknown[]) => unknown;
				return this.context.newAsyncifiedFunction('callback', async (...args) => {
					// Convert QuickJS handles to JS values
					const jsArgs = args.map(arg => this.context!.dump(arg));
					// Call the host function
					const result = await Promise.resolve(fn(...jsArgs));
					// Convert result back to QuickJS handle
					return this.jsToHandle(result);
				});
			}
			case 'object':
				if (Array.isArray(value)) {
					const arr = this.context.newArray();
					for (let i = 0; i < value.length; i++) {
						const elemHandle = this.jsToHandle(value[i]);
						this.context.setProp(arr, i, elemHandle);
						elemHandle.dispose();
					}
					return arr;
				} else {
					const obj = this.context.newObject();
					for (const [key, val] of Object.entries(value)) {
						const valHandle = this.jsToHandle(val);
						this.context.setProp(obj, key, valHandle);
						valHandle.dispose();
					}
					return obj;
				}
			default:
				return this.context.undefined;
		}
	}
}

// ============================================================================
// Factory Registration
// ============================================================================

/** Create a new TsBackend instance */
export function createTsBackend(): TsBackend {
	return new TsBackend();
}

// Register the TypeScript backend factory
registerBackendFactory('ts', createTsBackend);
