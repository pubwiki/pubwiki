/**
 * State Module for Lua
 *
 * Provides the State API for Lua scripts using the new TripleStore.
 * Native JS values map directly — no RDF type conversion needed.
 */

import type { TripleStore, Value, ChangeEvent } from '@pubwiki/rdfstore';
import { LuaTable } from '@pubwiki/lua';

/**
 * Convert a stored Value to a Lua-compatible form.
 * Only the top level is wrapped in LuaTable so Rust detects LUA_VALUE_SYMBOL
 * and calls val_to_lua_deep, which recursively handles inner JS arrays/objects
 * correctly (preserving the array vs object distinction).
 */
function valueToLua(v: unknown): unknown {
	if (Array.isArray(v) || (v !== null && typeof v === 'object')) {
		return new LuaTable(v);
	}
	return v;
}

/** Recursively unwrap LuaTable wrappers to get plain JS values for storage. */
function luaToValue(v: unknown): Value {
	if (v instanceof LuaTable) return luaToValue(v.value);
	if (Array.isArray(v)) return v.map(luaToValue) as Value;
	if (v !== null && typeof v === 'object') {
		const result: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			result[k] = luaToValue(val);
		}
		return result;
	}
	return v as Value;
}

export function createStateModule(getStore: () => Promise<TripleStore>) {
	const resolveStore = async () => {
		const s = await getStore();
		if (!s.isOpen) {
			throw new Error('Store not open. The connected State node may have been removed or re-initialized.');
		}
		return s;
	};

	return {
		async insert(_self: unknown, subject: string, predicate: string, object: unknown, graph?: string): Promise<void> {
			if (object === undefined || object === null) {
				throw new Error('Cannot insert nil/null value into store');
			}
			(await resolveStore()).insert(subject, predicate, luaToValue(object), graph);
		},

		async delete(_self: unknown, subject: string, predicate: string, object?: unknown, graph?: string): Promise<void> {
			(await resolveStore()).delete(subject, predicate, object != null ? luaToValue(object) : undefined, graph);
		},

		async match(_self: unknown, pattern: {
			subject?: string; predicate?: string; object?: unknown; graph?: string;
		}, checkpoint?: string): Promise<LuaTable<Array<{ subject: string; predicate: string; object: unknown; graph?: string }>>> {
			const triples = (await resolveStore()).match({
				subject: pattern.subject,
				predicate: pattern.predicate,
				object: pattern.object != null ? luaToValue(pattern.object) : undefined,
				graph: pattern.graph,
			}, checkpoint);
			return new LuaTable(triples.map(t => ({
				subject: t.subject,
				predicate: t.predicate,
				object: t.object,
				...(t.graph ? { graph: t.graph } : {}),
			})));
		},

		async get(_self: unknown, subject: string, predicate: string, graph?: string, checkpoint?: string): Promise<unknown> {
			const v = (await resolveStore()).get(subject, predicate, graph, checkpoint);
			return v !== undefined ? valueToLua(v) : undefined;
		},

		async set(_self: unknown, subject: string, predicate: string, object: unknown, graph?: string): Promise<void> {
			const store = await resolveStore();
			store.delete(subject, predicate, undefined, graph);
			if (object === undefined || object === null) return;
			store.insert(subject, predicate, luaToValue(object), graph);
		},

		async batchInsert(_self: unknown, triples: Array<{ subject: string; predicate: string; object: unknown; graph?: string }>): Promise<void> {
			if (triples.length === 0) return;
			(await resolveStore()).batchInsert(triples.map(t => ({
				subject: t.subject,
				predicate: t.predicate,
				object: luaToValue(t.object),
				graph: t.graph,
			})));
		},

		async checkpoint(_self: unknown, title?: string, description?: string): Promise<string> {
			return (await resolveStore()).checkpoint({ title: title || 'Checkpoint', description }).id;
		},

		async checkout(_self: unknown, checkpointId: string): Promise<void> {
			(await resolveStore()).checkout(checkpointId);
		},

		async listCheckpoints(_self: unknown): Promise<LuaTable<Array<{ id: string; title: string; description?: string; timestamp: number; tripleCount: number }>>> {
			const checkpoints = (await resolveStore()).listCheckpoints();
			return new LuaTable(checkpoints.map(cp => ({
				id: cp.id, title: cp.title, description: cp.description, timestamp: cp.timestamp, tripleCount: cp.tripleCount
			})));
		},

		async deleteCheckpoint(_self: unknown, checkpointId: string): Promise<void> {
			(await resolveStore()).deleteCheckpoint(checkpointId);
		},

		async *subscribeChanges(_self: unknown) {
			const store = await resolveStore();

			// Register the change listener BEFORE yielding the snapshot.
			// This ensures no changes are missed between snapshot consumption
			// and the consumer calling next() again.
			const queue: ChangeEvent[][] = [];
			let resolve: (() => void) | null = null;

			const unsubscribe = store.on('change', (changes: ChangeEvent[]) => {
				queue.push(changes);
				if (resolve) { resolve(); resolve = null; }
			});

			try {
				// Push current snapshot first
				// Yield a plain object with type discriminator; only wrap the data
				// arrays in LuaTable so Lua gets native tables for iteration.
				yield {
					type: 'snapshot',
					triples: new LuaTable(store.getAll().map(t => ({
						subject: t.subject,
						predicate: t.predicate,
						object: t.object,
						...(t.graph ? { graph: t.graph } : {}),
					}))),
				};

				while (true) {
					if (queue.length > 0) {
						const events = queue.shift()!;
						yield {
							type: 'changes',
							events: new LuaTable(events.map(e => ({
								type: e.type,
								triple: {
									subject: e.triple.subject,
									predicate: e.triple.predicate,
									object: e.triple.object,
									...(e.triple.graph ? { graph: e.triple.graph } : {}),
								},
							}))),
						};
					} else {
						await new Promise<void>(r => { resolve = r; });
					}
				}
			} finally {
				unsubscribe();
			}
		},
	};
}
