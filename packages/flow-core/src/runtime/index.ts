/**
 * flow-core/runtime
 * 
 * Graph runtime execution engine — artifact loading, loader backends,
 * service bridging, PubWiki module, and cloud saves.
 */

// ─── Runtime Types ──────────────────────────────────────────────────
export type {
	RuntimeGraph,
	RuntimeNode,
	RuntimeEdge,
	EntrypointConfig,
	EntryNodeDiscovery,
	JsModuleMode,
	JsModuleEntry,
	JsModuleRegistry,
	JsModuleDefinition,
	BackendConfig,
	BackendInitResult,
	ServiceCallResult,
	ServiceDefinition,
	RpcStreamCallback,
	LoaderBackend,
	BackendType,
	BackendFactory,
	RuntimeVfs,
	RDFStoreRef,
	LLMConfigRef,
	ConfirmationHandler,
	ArtifactContext,
} from './types';

// ─── Graph Loading & Node Discovery ─────────────────────────────────
export {
	loadArtifactGraph,
	discoverEntryNodes,
	findConnectedStateNode,
	findBackendVfsNode,
	findAssetVfsNodes,
} from './graph/artifact-loader';

// ─── Loader Runtime (Backend Registry + Initialization) ─────────────
export {
	BackendRegistry,
	detectBackendType,
	createBackendFromVfs,
	createLoaderBackend,
	createLoaderInterface,
	createServiceFactories,
} from './loader/runtime';
export type {
	LoaderInterface,
	CustomServiceFactory,
} from './loader/runtime';

// ─── Service Bridge ─────────────────────────────────────────────────
export { ServiceBridge } from './loader/service-bridge';

// ─── PubWiki Module ─────────────────────────────────────────────────
export { createPubWikiModule } from './modules/pubwiki';
export type {
	PubWikiModuleConfig,
	PubWikiRDFStore,
} from './modules/pubwiki';

// ─── Game Save ──────────────────────────────────────────────────────
export {
	createSaveCheckpoint,
	createSaveFromQuads,
	createSaveBatch,
	restoreFromSave,
	fetchSaves,
	getSave,
	deleteSave,
} from './save/gamesave';
export type {
	CreateSaveOptions,
	CreateSaveResult,
	CreateSaveBatchOptions,
	CreateSaveBatchResult,
	SaveRDFStore,
} from './save/gamesave';

// ─── Lua Backend ────────────────────────────────────────────────────
export { LuaBackend, createLuaBackendFactory, serviceLuaCode, typesLuaCode } from './backends/lua';
export { coerceToSchema, coerceOutputs, getIteratorYieldSchema } from './backends/lua/schema-coercion';

// ─── Loader Modules (JS modules for backends) ──────────────────────
export {
	createJsonModule,
	JSON_NULL,
	createPartialJsonModule,
	createStateModule,
	buildJsModules,
	createStringModule,
	createLLMModule,
	createPubChat,
	RDFMessageStore,
	CHAT_HISTORY_GRAPH_URI,
	createHashModule,
} from './modules';
export type { LLMModuleConfig } from './modules';

// ─── I/O Utilities ──────────────────────────────────────────────────
export { extractTar, extractTarGz, createTar, gzipCompress, gzipDecompress } from './io/tar';
export type { TarEntry } from './io/tar';
export { fetchAndPopulateVfs } from './io/vfs-fetcher';
