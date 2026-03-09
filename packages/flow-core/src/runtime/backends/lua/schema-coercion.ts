/**
 * Schema-based Type Coercion
 *
 * Resolves Lua's empty table ambiguity (empty table → either [] or {}).
 * Copied from Studio with minimal changes.
 */

interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	items?: JsonSchema;
	oneOf?: JsonSchema[];
	anyOf?: JsonSchema[];
	'x-function'?: boolean;
	'x-returns'?: JsonSchema;
}

export function coerceToSchema(value: unknown, schema: JsonSchema): unknown {
	if (value === null || value === undefined) return value;

	if (schema.oneOf) {
		for (const sub of schema.oneOf) {
			if (sub.type === 'null') continue;
			return coerceToSchema(value, sub);
		}
	}
	if (schema.anyOf) {
		for (const sub of schema.anyOf) {
			if (sub.type === 'null') continue;
			return coerceToSchema(value, sub);
		}
	}

	if (schema.type === 'array') {
		if (typeof value === 'object' && value !== null) {
			if (Array.isArray(value)) {
				return schema.items ? value.map(item => coerceToSchema(item, schema.items!)) : value;
			}
			const keys = Object.keys(value);
			if (keys.length === 0) return [];
			if (keys.every(k => /^\d+$/.test(k))) {
				const arr = Object.values(value);
				return schema.items ? arr.map(item => coerceToSchema(item, schema.items!)) : arr;
			}
		}
		return value;
	}

	if (schema.type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
		if (schema.properties) {
			const result: Record<string, unknown> = {};
			for (const [key, propSchema] of Object.entries(schema.properties)) {
				if (key in (value as Record<string, unknown>)) {
					result[key] = coerceToSchema((value as Record<string, unknown>)[key], propSchema);
				}
			}
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!(key in result)) {
					result[key] = (value as Record<string, unknown>)[key];
				}
			}
			return result;
		}
	}

	return value;
}

export function coerceOutputs(
	outputs: Record<string, unknown>,
	outputSchema: JsonSchema,
): Record<string, unknown> {
	if (!outputSchema.properties) return outputs;

	const result: Record<string, unknown> = {};
	for (const [key, propSchema] of Object.entries(outputSchema.properties)) {
		if (key in outputs) {
			result[key] = coerceToSchema(outputs[key], propSchema);
		}
	}
	for (const key of Object.keys(outputs)) {
		if (!(key in result)) result[key] = outputs[key];
	}
	return result;
}

export function getIteratorYieldSchema(outputSchema: JsonSchema): JsonSchema | null {
	if (!outputSchema.properties) return null;
	const propKeys = Object.keys(outputSchema.properties);
	if (propKeys.length !== 1) return null;
	const iteratorSchema = outputSchema.properties[propKeys[0]];
	if (!iteratorSchema?.['x-function'] || !iteratorSchema['x-returns']) return null;
	return iteratorSchema['x-returns'];
}
