/**
 * Loader Modules
 *
 * JS modules that are registered into loader backends (Lua/TS).
 * These provide standard APIs (JSON, State, partial-json) to user scripts.
 */

import type { TripleStore } from '@pubwiki/rdfstore';
import type { JsModuleDefinition, JsModuleRegistry } from '../types';
import { createHashModule } from './hash';
import { createJsonModule } from './json';
import { createPartialJsonModule } from './partial-json';
import { createStateModule } from './rdf';

export { createJsonModule, JSON_NULL } from './json';
export { createPartialJsonModule } from './partial-json';
export { createStateModule } from './rdf';
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
export { createHashModule } from './hash';

/**
 * Build the JS module registry for a loader node.
 *
 * Registers: json (global), State (global, if RDF store available),
 * partial-json, and optionally a pubwiki module.
 */
export async function buildJsModules(options: {
	rdfStore?: TripleStore;
	stateNodeId?: string;
	getNodeRDFStore: (nodeId: string) => Promise<TripleStore>;
	pubwikiModule?: JsModuleDefinition;
}): Promise<JsModuleRegistry> {
	const modules: JsModuleRegistry = new Map();

	// JSON module (preloaded globally)
	modules.set('json', { module: createJsonModule(), mode: 'global' });

	// State module (global, if RDF store is available)
	if (options.rdfStore && options.stateNodeId) {
		const sid = options.stateNodeId;
		const stateModule = createStateModule(() => options.getNodeRDFStore(sid));
		modules.set('State', {
			module: stateModule,
			mode: 'global',
		});
	}

	// Partial JSON module
	modules.set('partial-json', { module: createPartialJsonModule() });

	// Hash module (xxhash via WASM)
	modules.set('hash', { module: await createHashModule() });

	// PubWiki module (optional)
	if (options.pubwikiModule) {
		modules.set('pubwiki', { module: options.pubwikiModule });
	}

	return modules;
}
