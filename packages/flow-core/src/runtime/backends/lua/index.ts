/**
 * Lua Backend for flow-core
 *
 * Implements LoaderBackend using @pubwiki/lua for Lua VM execution.
 * Lua source code (service.lua, types.lua) is injected — not embedded —
 * so flow-core stays free of Vite-specific imports.
 */

import {
	loadRunner,
	createLuaInstance,
	type LuaInstance,
} from '@pubwiki/lua';
import {
	createMountedVfs,
	getMountedProvider,
	createVfs,
	type Vfs,
	type MountedVfsProvider,
	type VfsProvider,
	type VfsStat,
} from '@pubwiki/vfs';
import type {
	LoaderBackend,
	BackendConfig,
	BackendFactory,
	BackendInitResult,
	ServiceCallResult,
	ServiceDefinition,
	JsModuleDefinition,
	RpcStreamCallback,
} from '../../types';

import { coerceOutputs, coerceToSchema, getIteratorYieldSchema } from './schema-coercion';

// ============================================================================
// Lua Source Options
// ============================================================================

/**
 * Options for creating a LuaBackend.
 * Lua source code for core libraries must be provided by the app layer.
 */
export interface LuaBackendOptions {
	/** Content of service.lua (ServiceRegistry + ServiceBuilder) */
	serviceLuaCode: string;
	/** Content of types.lua (Type system) */
	typesLuaCode: string;
}

// ============================================================================
// MemoryVfsProvider — in-memory VFS for embedding core Lua files
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

	async readFile(path: string): Promise<Uint8Array> {
		const normalized = this.normalizePath(path);
		const content = this.files.get(normalized);
		if (!content) throw new Error(`ENOENT: no such file: ${normalized}`);
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
		this.directories.delete(this.normalizePath(path));
	}

	async stat(path: string): Promise<VfsStat> {
		const normalized = this.normalizePath(path);
		const now = new Date();
		if (this.files.has(normalized)) {
			return { isFile: true, isDirectory: false, size: this.files.get(normalized)!.length, createdAt: now, updatedAt: now };
		}
		if (this.directories.has(normalized)) {
			return { isFile: false, isDirectory: true, size: 0, createdAt: now, updatedAt: now };
		}
		throw new Error(`ENOENT: no such file or directory: ${normalized}`);
	}

	async exists(path: string): Promise<boolean> {
		const normalized = this.normalizePath(path);
		return this.files.has(normalized) || this.directories.has(normalized);
	}

	async rename(from: string, to: string): Promise<void> {
		const content = await this.readFile(from);
		await this.writeFile(to, content);
		await this.unlink(from);
	}

	async copyFile(from: string, to: string): Promise<void> {
		const content = await this.readFile(from);
		await this.writeFile(to, new Uint8Array(content));
	}

	async createFile(path: string, content: string): Promise<void> {
		await this.writeFile(path, this.encoder.encode(content));
	}
}

function createMemoryVfs(): Vfs<VfsProvider> {
	return createVfs(new MemoryVfsProvider());
}

// ============================================================================
// LuaBackend
// ============================================================================

export class LuaBackend implements LoaderBackend {
	readonly type = 'lua';

	private instance: LuaInstance | null = null;
	private mountedVfs: Vfs<MountedVfsProvider> | null = null;
	private ready = false;
	private currentConfig: BackendConfig | null = null;
	private serviceSchemas = new Map<string, ServiceDefinition>();
	private readonly options: LuaBackendOptions;

	constructor(options: LuaBackendOptions) {
		this.options = options;
	}

	async initialize(config: BackendConfig): Promise<BackendInitResult> {
		try {
			await this.destroy();
			this.currentConfig = config;

			await loadRunner();

			// Create mounted VFS
			this.mountedVfs = createMountedVfs();
			const provider = getMountedProvider(this.mountedVfs);
			if (!provider) throw new Error('Failed to get MountedVfsProvider');

			// Mount core Lua libraries
			const coreVfs = createMemoryVfs();
			await (coreVfs.getProvider() as MemoryVfsProvider).createFile('/service.lua', this.options.serviceLuaCode);
			await (coreVfs.getProvider() as MemoryVfsProvider).createFile('/types.lua', this.options.typesLuaCode);
			provider.mount('/core', coreVfs);

			// Mount backend VFS (the user's Lua code)
			provider.mount('/user/backend', config.backendVfs as unknown as Vfs);

			// Mount asset VFS directories
			for (const [path, vfs] of config.assetMounts) {
				provider.mount(`/user/assets${path}`, vfs as unknown as Vfs);
			}

			// Create Lua instance
			this.instance = createLuaInstance({
				vfs: this.mountedVfs,
				workingDirectory: '/',
			});

			// Register JS modules
			if (config.jsModules) {
				for (const [name, entry] of config.jsModules) {
					this.instance.registerJsModule(name, entry.module, { mode: entry.mode ?? 'module' });
				}
			}

			// Execute init.lua
			const initResult = await this.instance.run(`
				local init = require("user/backend/init")
				local ServiceRegistry = require("core/service")
				return ServiceRegistry.listServices()
			`);

			if (initResult.error) throw new Error(initResult.error);

			this.ready = true;

			let services: string[];
			if (Array.isArray(initResult.result)) {
				services = initResult.result;
			} else if (initResult.result && typeof initResult.result === 'object') {
				services = Object.values(initResult.result as Record<string, string>);
			} else {
				services = [];
			}

			return { success: true, services, error: null };
		} catch (error) {
			this.ready = false;
			return { success: false, services: [], error: error instanceof Error ? error.message : String(error) };
		}
	}

	async reload(): Promise<BackendInitResult> {
		if (!this.currentConfig) {
			return { success: false, services: [], error: 'Cannot reload: backend was never initialized' };
		}
		return this.initialize(this.currentConfig);
	}

	async destroy(): Promise<void> {
		if (this.instance) {
			this.instance.destroy();
			this.instance = null;
		}
		this.mountedVfs = null;
		this.ready = false;
		this.serviceSchemas.clear();
	}

	isReady(): boolean {
		return this.ready && this.instance !== null;
	}

	registerJsModule(name: string, module: JsModuleDefinition): void {
		if (!this.instance) throw new Error('Lua backend not initialized');
		this.instance.registerJsModule(name, module);
	}

	async listServices(): Promise<ServiceDefinition[]> {
		if (!this.instance) throw new Error('Lua backend not initialized');

		const result = await this.instance.run(`
			local ServiceRegistry = require("core/service")
			return ServiceRegistry.export()
		`);

		if (result.error) throw new Error(result.error);

		const servicesMap = result.result as Record<string, ServiceDefinition>;
		const services = Object.values(servicesMap);

		this.serviceSchemas.clear();
		for (const service of services) {
			this.serviceSchemas.set(service.identifier, service);
		}

		return services;
	}

	async callService(
		identifier: string,
		inputs: Record<string, unknown>,
	): Promise<ServiceCallResult> {
		if (!this.instance) {
			return { success: false, error: 'Lua backend not initialized' };
		}

		const result = await this.instance.run(
			`
			local ServiceRegistry = require("core/service")
			local outputs = ServiceRegistry.call(identifier, inputs)
			return outputs
		`,
			{ identifier, inputs },
		);

		if (result.error) return { success: false, error: result.error };

		let outputs = result.result as Record<string, unknown>;
		if (outputs && outputs._error) {
			return { success: false, error: outputs._error as string };
		}

		const serviceDef = this.serviceSchemas.get(identifier);
		if (serviceDef && outputs) {
			outputs = coerceOutputs(outputs, serviceDef.outputs as Parameters<typeof coerceOutputs>[1]);
		}

		return { success: true, outputs };
	}

	async streamService(
		identifier: string,
		inputs: Record<string, unknown>,
		on: RpcStreamCallback,
	): Promise<void> {
		if (!this.instance) throw new Error('Lua backend not initialized');

		const serviceDef = this.serviceSchemas.get(identifier);
		const yieldSchema = serviceDef
			? getIteratorYieldSchema(serviceDef.outputs as Parameters<typeof getIteratorYieldSchema>[0])
			: null;

		const coercedCallback = yieldSchema
			? (value: unknown) => on(coerceToSchema(value, yieldSchema))
			: on;

		const result = await this.instance.run(
			`
			local ServiceRegistry = require("core/service")
			ServiceRegistry.iterate(identifier, inputs, callback)
		`,
			{ identifier, inputs, callback: coercedCallback },
		);

		if (result.error) throw new Error(result.error);
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a BackendFactory that produces LuaBackend instances
 * with the given Lua source code.
 */
export function createLuaBackendFactory(options: LuaBackendOptions): BackendFactory {
	return () => new LuaBackend(options);
}
