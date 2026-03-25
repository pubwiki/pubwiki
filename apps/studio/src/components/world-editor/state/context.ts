/**
 * World Editor context — shared state accessible to all child components
 * via Svelte's setContext / getContext.
 */

import { getContext, setContext } from 'svelte';
import type { TripleStore } from '@pubwiki/rdfstore';
import type { TripleTranslator, TripleOperation, StateDataView } from '@pubwiki/world-editor';
import type { StateData } from '@pubwiki/world-editor';

const CONTEXT_KEY = 'world-editor';

export interface WorldEditorContext {
	readonly projectId: string;
	readonly store: TripleStore;
	readonly translator: TripleTranslator;
	readonly view: StateDataView;
	readonly stateData: StateData;
	applyOps(ops: TripleOperation[]): void;
	navigateTab(tab: string): void;
}

export function setWorldEditorContext(ctx: WorldEditorContext) {
	setContext(CONTEXT_KEY, ctx);
}

export function getWorldEditorContext(): WorldEditorContext {
	return getContext<WorldEditorContext>(CONTEXT_KEY);
}

/**
 * Apply triple operations to a store.
 * Handles insert, delete, and set (delete old value + insert new).
 */
export function applyOperationsToStore(store: TripleStore, ops: TripleOperation[]): void {
	store.batch((writer) => {
		for (const op of ops) {
			switch (op.op) {
				case 'insert':
					writer.insert(op.subject, op.predicate, op.object, op.graph);
					break;
				case 'delete':
					writer.delete(op.subject, op.predicate, op.object, op.graph);
					break;
				case 'set':
					// Delete existing value(s) for this (s, p, g), then insert
					writer.delete(op.subject, op.predicate, undefined, op.graph);
					writer.insert(op.subject, op.predicate, op.object, op.graph);
					break;
			}
		}
	});
}
