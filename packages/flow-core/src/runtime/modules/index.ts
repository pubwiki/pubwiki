/**
 * Loader Modules
 *
 * JS modules that are registered into loader backends (Lua/TS).
 * These provide standard APIs (JSON, State, partial-json) to user scripts.
 */

import type { RDFStore } from '@pubwiki/rdfstore';
import type { JsModuleDefinition, JsModuleRegistry } from '../types';
import { createJsonModule } from './json';
import { createPartialJsonModule } from './partial-json';
import { createStateModule } from './rdf';

export { createJsonModule, JSON_NULL } from './json';
export { createPartialJsonModule } from './partial-json';
export { createStateModule, luaValueToRdf, rdfToLuaValue, XSD_STRING, XSD_INTEGER, XSD_DOUBLE, XSD_BOOLEAN, PUBWIKI_LUAVALUE } from './rdf';
export {
	createStringModule,
	len, sub, reverse, upper, lower, char_at, chars, byte, char,
	find, match, gmatch, gsub, rep, format, toGraphemes, luaIndexToJs,
} from './string';
export {
	createLLMModule, createPubChat, RDFMessageStore, CHAT_HISTORY_GRAPH_URI,
	type LLMModuleConfig,
} from './llm';
export { RDFMessageStore as LLMRDFMessageStore } from './llm-rdf-store';

/**
 * Build the JS module registry for a loader node.
 *
 * Registers: json (global), State (global, if RDF store available),
 * partial-json, and optionally a pubwiki module.
 */
export function buildJsModules(options: {
	rdfStore?: RDFStore;
	stateNodeId?: string;
	getNodeRDFStore: (nodeId: string) => Promise<RDFStore>;
	pubwikiModule?: JsModuleDefinition;
}): JsModuleRegistry {
	const modules: JsModuleRegistry = new Map();

	// JSON module (preloaded globally)
	modules.set('json', { module: createJsonModule() as unknown as JsModuleDefinition, mode: 'global' });

	// State module (global, if RDF store is available)
	if (options.rdfStore && options.stateNodeId) {
		const sid = options.stateNodeId;
		modules.set('State', {
			module: createStateModule(() => options.getNodeRDFStore(sid)),
			mode: 'global',
		});
	}

	// Partial JSON module
	modules.set('partial-json', { module: createPartialJsonModule() });

	// PubWiki module (optional)
	if (options.pubwikiModule) {
		modules.set('pubwiki', { module: options.pubwikiModule });
	}

	return modules;
}
