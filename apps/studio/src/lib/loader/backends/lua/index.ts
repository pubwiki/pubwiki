/**
 * Lua Backend Implementation
 * 
 * Implements LoaderBackend using @pubwiki/lua for Lua VM execution.
 * Detected when init.lua exists in the backend VFS.
 */

import {
	loadRunner,
	createLuaInstance,
	type LuaInstance
} from '@pubwiki/lua';
import {
	createMountedVfs,
	getMountedProvider,
	createVfs,
	type Vfs,
	type MountedVfsProvider,
	type VfsProvider,
	type VfsStat
} from '@pubwiki/vfs';
import type { ServiceDefinition, RpcStub } from '@pubwiki/sandbox-host';

import type {
	LoaderBackend,
	BackendConfig,
	BackendInitResult,
	ServiceCallResult,
	JsModuleDefinition
} from '../../types';
import { registerBackendFactory } from '../../types';

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

	/** Helper to create a file with string content */
	async createFile(path: string, content: string): Promise<void> {
		await this.writeFile(path, this.encoder.encode(content));
	}
}

/** Create a new in-memory VFS */
function createMemoryVfs(): Vfs<VfsProvider> {
	return createVfs(new MemoryVfsProvider());
}

// ============================================================================
// LuaBackend Implementation
// ============================================================================

/**
 * Lua Backend implementation using @pubwiki/lua
 */
export class LuaBackend implements LoaderBackend {
	readonly type = 'lua';

	private instance: LuaInstance | null = null;
	private mountedVfs: Vfs<MountedVfsProvider> | null = null;
	private ready = false;

	// ========================================================================
	// LoaderBackend Interface
	// ========================================================================

	async initialize(config: BackendConfig): Promise<BackendInitResult> {
		try {
			// Clean up any existing instance
			await this.destroy();

			// Ensure Lua runtime is loaded
			await loadRunner();

			// Create mounted VFS
			this.mountedVfs = createMountedVfs();
			const provider = getMountedProvider(this.mountedVfs);

			if (!provider) {
				throw new Error('Failed to get MountedVfsProvider');
			}

			// Create memory VFS for core libraries
			const coreVfs = createMemoryVfs();
			await coreVfs.createFile('/service.lua', serviceLuaCode);
			await coreVfs.createFile('/types.lua', typesLuaCode);
			provider.mount('/core', coreVfs);

			// Mount backend VFS
			provider.mount('/user/backend', config.backendVfs);

			// Mount asset VFS
			for (const [path, vfs] of config.assetMounts) {
				provider.mount(`/user/assets${path}`, vfs);
			}

			// Create Lua instance with RDF store if provided
			this.instance = createLuaInstance({
				vfs: this.mountedVfs,
				workingDirectory: '/',
				rdfStore: config.rdfStore
			});

			// Register JS modules from config
			if (config.jsModules) {
				for (const [name, module] of config.jsModules) {
					this.instance.registerJsModule(name, module);
				}
			}

			// Execute init.lua
			const initResult = await this.instance.run(`
				-- Load init.lua
				local init = require("user/backend/init")
				
				-- Return registered services list
				local ServiceRegistry = require("core/service")
				return ServiceRegistry.listServices()
			`);

			if (initResult.error) {
				throw new Error(initResult.error);
			}

			this.ready = true;

			// Extract services list
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

			return {
				success: true,
				services,
				error: null
			};
		} catch (error) {
			this.ready = false;
			return {
				success: false,
				services: [],
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	async destroy(): Promise<void> {
		if (this.instance) {
			this.instance.destroy();
			this.instance = null;
		}
		this.mountedVfs = null;
		this.ready = false;
	}

	isReady(): boolean {
		return this.ready && this.instance !== null;
	}

	registerJsModule(name: string, module: JsModuleDefinition): void {
		if (!this.instance) {
			throw new Error('Lua backend not initialized');
		}
		this.instance.registerJsModule(name, module);
	}

	async listServices(): Promise<ServiceDefinition[]> {
		if (!this.instance) {
			throw new Error('Lua backend not initialized');
		}

		const result = await this.instance.run(`
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

	async callService(
		identifier: string,
		inputs: Record<string, unknown>
	): Promise<ServiceCallResult> {
		if (!this.instance) {
			return { success: false, error: 'Lua backend not initialized' };
		}

		console.log('[LuaBackend.callService] invoked with inputs', inputs);
		const result = await this.instance.run(
			`
			local ServiceRegistry = require("core/service")
			local outputs = ServiceRegistry.call(identifier, inputs)
			return outputs
		`,
			{ identifier, inputs }
		);

		if (result.error) {
			return { success: false, error: result.error };
		}

		const outputs = result.result as Record<string, unknown>;
		if (outputs && outputs._error) {
			return { success: false, error: outputs._error as string };
		}

		return { success: true, outputs };
	}

	async streamService(
		identifier: string,
		inputs: Record<string, unknown>,
		on: RpcStub<(value: unknown) => Promise<void> | void>
	): Promise<void> {
		if (!this.instance) {
			throw new Error('Lua backend not initialized');
		}

		console.log(
			'[LuaBackend.streamService] invoked with inputs',
			inputs,
			await this.instance.run('return inputs:toJSON()', { inputs })
		);
		// Use callback pattern: iterate in Lua and call JS callback for each value
		const result = await this.instance.run(
			`
			local ServiceRegistry = require("core/service")
			local iterator = ServiceRegistry.call(identifier, inputs)
			
			-- If returned value is an iterator/generator, iterate and call callback
			if type(iterator) == "function" then
				for value in iterator do
					if value == nil then break end
					callback(value)
				end
			else
				-- Single value, call callback once
				if iterator ~= nil then
					callback(iterator)
				end
			end
		`,
			{ identifier, inputs, callback: on }
		);

		if (result.error) {
			throw new Error(result.error);
		}
	}
}

// ============================================================================
// Factory Registration
// ============================================================================

/** Create a new LuaBackend instance */
export function createLuaBackend(): LuaBackend {
	return new LuaBackend();
}

// Register the Lua backend factory
registerBackendFactory('lua', createLuaBackend);
