/**
 * State Module for Lua
 *
 * Provides the State API for Lua scripts using the new TripleStore.
 * Native JS values map directly — no RDF type conversion needed.
 */

import type { TripleStore, Value } from '@pubwiki/rdfstore';
import { LuaTable } from '@pubwiki/lua';

/** Convert a stored Value back to a Lua-compatible form (objects/arrays → LuaTable). */
function valueToLua(v: unknown): unknown {
	if (Array.isArray(v)) return new LuaTable(v.map(valueToLua));
	if (v !== null && typeof v === 'object') {
		const converted: Record<string, unknown> = {};
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
			converted[k] = valueToLua(val);
		}
		return new LuaTable(converted);
	}
	return v;
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
			(await resolveStore()).insert(subject, predicate, object as Value, graph);
		},

		async delete(_self: unknown, subject: string, predicate: string, object?: unknown, graph?: string): Promise<void> {
			(await resolveStore()).delete(subject, predicate, object as Value | undefined, graph);
		},

		async match(_self: unknown, pattern: {
			subject?: string; predicate?: string; object?: unknown; graph?: string;
		}): Promise<LuaTable<Array<{ subject: string; predicate: string; object: unknown; graph?: string }>>> {
			const triples = (await resolveStore()).match({
				subject: pattern.subject,
				predicate: pattern.predicate,
				object: pattern.object as Value | undefined,
				graph: pattern.graph,
			});
			return new LuaTable(triples.map(t => ({
				subject: t.subject,
				predicate: t.predicate,
				object: valueToLua(t.object),
				...(t.graph ? { graph: t.graph } : {}),
			})));
		},

		async get(_self: unknown, subject: string, predicate: string, graph?: string): Promise<unknown> {
			const v = (await resolveStore()).get(subject, predicate, graph);
			return v !== undefined ? valueToLua(v) : undefined;
		},

		async set(_self: unknown, subject: string, predicate: string, object: unknown, graph?: string): Promise<void> {
			const store = await resolveStore();
			store.delete(subject, predicate, undefined, graph);
			if (object === undefined || object === null) return;
			store.insert(subject, predicate, object as Value, graph);
		},

		async batchInsert(_self: unknown, triples: Array<{ subject: string; predicate: string; object: unknown; graph?: string }>): Promise<void> {
			if (triples.length === 0) return;
			(await resolveStore()).batchInsert(triples.map(t => ({
				subject: t.subject,
				predicate: t.predicate,
				object: t.object as Value,
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
	};
}
