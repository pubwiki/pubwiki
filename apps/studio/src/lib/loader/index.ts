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
	JsModuleEntry,
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

// Register backends (side effect: registers factories)
import './backends/lua';
import './backends/ts';

// Export backends for direct access if needed
export { LuaBackend, createLuaBackend } from './backends/lua';
export { TsBackend, createTsBackend } from './backends/ts';

// Export modules
export {
	createLLMModule,
	createPubChat,
	RDFMessageStore,
	CHAT_HISTORY_GRAPH_URI,
	createPubWikiModule,
	createPubWikiContext,
	type LLMModuleConfig,
	type PubWikiModuleContext
} from './modules';

// Export documentation generator
export {
	generateServiceDocs,
	type GeneratedDocs
} from './docs-generator';
