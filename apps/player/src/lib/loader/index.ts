/**
 * Loader Initialization for Player
 *
 * Thin wrapper over flow-core's loader backends and modules.
 * Provides Lua source code injection (via Vite ?raw imports)
 * and app-specific registry setup.
 */

import {
	BackendRegistry,
	createLuaBackendFactory,
	createLoaderBackend,
	buildJsModules,
	type BackendConfig,
	type JsModuleRegistry,
	type LoaderBackend,
	type BackendInitResult,
	type RuntimeVfs,
} from '@pubwiki/flow-core';
import type { Vfs } from '@pubwiki/vfs';

// Lua source code — injected via Vite ?raw
import serviceLuaCode from '$lib/assets/lua/service.lua?raw';
import typesLuaCode from '$lib/assets/lua/types.lua?raw';

/**
 * Create a pre-configured BackendRegistry with Player's backends.
 */
export function createPlayerRegistry(): BackendRegistry {
	const registry = new BackendRegistry();
	registry.register('lua', createLuaBackendFactory({ serviceLuaCode, typesLuaCode }));
	return registry;
}

// Re-export buildJsModules from flow-core for convenience
export { buildJsModules };

/**
 * Initialize a loader backend for a specific node in the Player.
 */
export async function initializePlayerLoader(
	registry: BackendRegistry,
	backendVfs: Vfs,
	assetMounts: Map<string, Vfs>,
	jsModules: JsModuleRegistry,
	rdfStore?: unknown,
): Promise<{ backend: LoaderBackend | null; result: BackendInitResult }> {
	const config: BackendConfig = {
		backendVfs: backendVfs as unknown as RuntimeVfs,
		assetMounts: assetMounts as unknown as Map<string, RuntimeVfs>,
		rdfStore,
		jsModules,
	};

	return createLoaderBackend(registry, config);
}
