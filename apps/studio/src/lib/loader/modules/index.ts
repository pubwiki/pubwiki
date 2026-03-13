/**
 * Loader Modules
 * 
 * JS modules that can be registered with Loader backends.
 * Shared modules are re-exported from @pubwiki/flow-core.
 */

// Shared modules from flow-core
export {
  buildJsModules,
  createLLMModule,
  createPubChat,
  RDFMessageStore,
  CHAT_HISTORY_GRAPH_URI,
  type LLMModuleConfig,
  createPartialJsonModule,
  createJsonModule,
  JSON_NULL,
  createStateModule,
  luaValueToRdf,
  rdfToLuaValue,
  XSD_STRING,
  XSD_INTEGER,
  XSD_DOUBLE,
  XSD_BOOLEAN,
  PUBWIKI_LUAVALUE,
  createStringModule,
} from '@pubwiki/flow-core';

// Studio-specific: PubWiki Module (depends on Svelte)
export {
  createPubWikiModule,
  createPubWikiContext,
  type PubWikiModuleContext
} from './pubwiki'
