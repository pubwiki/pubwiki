/**
 * Loader Module
 * 
 * Provides backend abstraction for Loader nodes.
 * Supports auto-detection of backend type based on VFS contents.
 */

// Types and interfaces
export type {
	LoaderBackend,
	BackendConfig,
	BackendInitResult,
	ServiceCallResult,
	JsModuleDefinition,
	JsModuleRegistry,
	RDFStore,
	BackendType,
	BackendFactory,
	ServiceDefinition,
	LLMConfig
} from './types';

export {
	detectBackendType,
	registerBackendFactory,
	createBackend,
	createBackendFromVfs
} from './types';

// Register Lua backend (side effect: registers factory)
import './backends/lua';

// Export Lua backend for direct access if needed
export { LuaBackend, createLuaBackend } from './backends/lua';
