/**
 * RDF State Module for Lua
 *
 * Provides the State API for Lua scripts, allowing RDF triple/quad storage
 * with checkpoint-based persistence. Same interface as Studio's implementation.
 */

import type { RDFStore, QuadPattern } from '@pubwiki/rdfstore';
import { LuaTable } from '@pubwiki/lua';
import { DataFactory } from 'n3';

const { namedNode, literal, defaultGraph } = DataFactory;

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';
const XSD_INTEGER = 'http://www.w3.org/2001/XMLSchema#integer';
const XSD_DOUBLE = 'http://www.w3.org/2001/XMLSchema#double';
const XSD_BOOLEAN = 'http://www.w3.org/2001/XMLSchema#boolean';
const PUBWIKI_LUAVALUE = 'https://pub.wiki/datatype#luavalue';

function luaValueToRdf(value: unknown): [string, string] {
	if (typeof value === 'string') return [value, XSD_STRING];
	if (typeof value === 'number') {
		return Number.isInteger(value) ? [String(value), XSD_INTEGER] : [String(value), XSD_DOUBLE];
	}
	if (typeof value === 'boolean') return [value ? 'true' : 'false', XSD_BOOLEAN];
	if (value === null || value === undefined) {
		throw new Error('Cannot insert nil/null value into RDF store');
	}
	return [JSON.stringify(value), PUBWIKI_LUAVALUE];
}

function rdfToLuaValue(value: string, datatype: string): unknown {
	switch (datatype) {
		case XSD_STRING: return value;
		case XSD_INTEGER: { const n = parseInt(value, 10); if (isNaN(n)) throw new Error(`Invalid integer '${value}'`); return n; }
		case XSD_DOUBLE: { const n = parseFloat(value); if (isNaN(n)) throw new Error(`Invalid double '${value}'`); return n; }
		case XSD_BOOLEAN: return value === 'true';
		case PUBWIKI_LUAVALUE: return JSON.parse(value);
		default: return value;
	}
}

export function createStateModule(getStore: () => Promise<RDFStore>) {
	const resolveStore = async () => {
		const s = await getStore();
		if (!s.isOpen) {
			throw new Error('Store not open. The connected State node may have been removed or re-initialized.');
		}
		return s;
	};

	return {
		async insert(_self: unknown, subject: string, predicate: string, object: unknown, graph?: string): Promise<void> {
			const [objectStr, datatype] = luaValueToRdf(object);
			const objectTerm = literal(objectStr, namedNode(datatype));
			const graphTerm = graph ? namedNode(graph) : defaultGraph();
			await (await resolveStore()).insert(namedNode(subject), namedNode(predicate), objectTerm, graphTerm);
		},

		async delete(_self: unknown, subject: string, predicate: string, object?: unknown, graph?: string): Promise<void> {
			let objectTerm = undefined;
			if (object !== undefined && object !== null) {
				const [objectStr, datatype] = luaValueToRdf(object);
				objectTerm = literal(objectStr, namedNode(datatype));
			}
			const graphTerm = graph ? namedNode(graph) : undefined;
			await (await resolveStore()).delete(namedNode(subject), namedNode(predicate), objectTerm, graphTerm);
		},

		async match(_self: unknown, pattern: {
			subject?: string; predicate?: string; object?: unknown; graph?: string;
		}): Promise<LuaTable<Array<{ subject: string; predicate: string; object: unknown; graph?: string }>>> {
			const queryPattern: QuadPattern = {};
			if (pattern.subject) queryPattern.subject = namedNode(pattern.subject);
			if (pattern.predicate) queryPattern.predicate = namedNode(pattern.predicate);
			if (pattern.object !== undefined && pattern.object !== null) {
				const [objectStr, datatype] = luaValueToRdf(pattern.object);
				queryPattern.object = literal(objectStr, namedNode(datatype));
			}
			if (pattern.graph) queryPattern.graph = namedNode(pattern.graph);

			const quads = await (await resolveStore()).query(queryPattern);
			const mapped = quads.map(q => {
				const objectValue = q.object.termType === 'Literal'
					? rdfToLuaValue(q.object.value, q.object.datatype?.value || XSD_STRING)
					: q.object.value;
				const quadResult: { subject: string; predicate: string; object: unknown; graph?: string } = {
					subject: q.subject.value, predicate: q.predicate.value, object: objectValue
				};
				if (q.graph.termType !== 'DefaultGraph') quadResult.graph = q.graph.value;
				return quadResult;
			});
			return new LuaTable(mapped);
		},

		async get(_self: unknown, subject: string, predicate: string, graph?: string): Promise<unknown> {
			const queryPattern: QuadPattern = { subject: namedNode(subject), predicate: namedNode(predicate) };
			if (graph) queryPattern.graph = namedNode(graph);
			const quads = await (await resolveStore()).query(queryPattern);
			if (quads.length === 0) return undefined;
			const first = quads[0];
			if (first.object.termType === 'Literal') {
				return new LuaTable(rdfToLuaValue(first.object.value, first.object.datatype?.value || XSD_STRING));
			}
			return first.object.value;
		},

		async set(_self: unknown, subject: string, predicate: string, object: unknown, graph?: string): Promise<void> {
			const graphTerm = graph ? namedNode(graph) : undefined;
			await (await resolveStore()).delete(namedNode(subject), namedNode(predicate), undefined, graphTerm);
			if (object === undefined || object === null) return;
			const [objectStr, datatype] = luaValueToRdf(object);
			const objectTerm = literal(objectStr, namedNode(datatype));
			await (await resolveStore()).insert(namedNode(subject), namedNode(predicate), objectTerm, graphTerm ?? defaultGraph());
		},

		async batchInsert(_self: unknown, quads: Array<{ subject: string; predicate: string; object: unknown; graph?: string }>): Promise<void> {
			if (quads.length === 0) return;
			const n3Quads = quads.map(q => {
				const [objectStr, datatype] = luaValueToRdf(q.object);
				return DataFactory.quad(
					namedNode(q.subject), namedNode(q.predicate),
					literal(objectStr, namedNode(datatype)),
					q.graph ? namedNode(q.graph) : defaultGraph()
				);
			});
			await (await resolveStore()).batchInsert(n3Quads);
		},

		async checkpoint(_self: unknown, title?: string, description?: string): Promise<string> {
			const cp = await (await resolveStore()).checkpoint({ title: title || 'Checkpoint', description: description || '' });
			return cp.id;
		},

		async checkout(_self: unknown, checkpointId: string): Promise<void> {
			await (await resolveStore()).loadCheckpoint(checkpointId);
		},

		async listCheckpoints(_self: unknown): Promise<LuaTable<Array<{ id: string; title: string; description?: string; timestamp: number; quadCount: number }>>> {
			const checkpoints = await (await resolveStore()).listCheckpoints();
			return new LuaTable(checkpoints.map(cp => ({
				id: cp.id, title: cp.title, description: cp.description, timestamp: cp.timestamp, quadCount: cp.quadCount
			})));
		},

		async deleteCheckpoint(_self: unknown, checkpointId: string): Promise<void> {
			await (await resolveStore()).deleteCheckpoint(checkpointId);
		},

		async *query(_self: unknown, sparql: string): AsyncIterableIterator<Record<string, unknown>> {
			for await (const binding of (await resolveStore()).sparqlQuery(sparql)) {
				yield binding;
			}
		}
	};
}

export { luaValueToRdf, rdfToLuaValue, XSD_STRING, XSD_INTEGER, XSD_DOUBLE, XSD_BOOLEAN, PUBWIKI_LUAVALUE };
