/**
 * Schema-based Type Coercion
 * 
 * Functions to coerce Lua values to match JSON Schema types.
 * Main purpose: resolve Lua's empty table ambiguity where `{}` could be 
 * either an empty array or empty object in JavaScript.
 */

import type { JsonSchema } from '@pubwiki/sandbox-host';

/**
 * Coerce a value according to JSON Schema.
 * 
 * Main purpose: resolve Lua's empty table ambiguity.
 * In Lua, `{}` is an empty table which could be either an empty array or empty object.
 * When converted to JS, it becomes `{}` (object), but schema may expect `[]` (array).
 * 
 * @param value - The value from Lua
 * @param schema - JSON Schema describing expected type
 * @returns Coerced value matching the schema type
 */
export function coerceToSchema(value: unknown, schema: JsonSchema): unknown {
	if (value === null || value === undefined) {
		return value;
	}

	// Handle oneOf/anyOf - try each option
	if (schema.oneOf) {
		for (const subSchema of schema.oneOf) {
			// Skip null type in oneOf (used for optional/nullable)
			if (subSchema.type === 'null') continue;
			return coerceToSchema(value, subSchema);
		}
	}
	if (schema.anyOf) {
		for (const subSchema of schema.anyOf) {
			if (subSchema.type === 'null') continue;
			return coerceToSchema(value, subSchema);
		}
	}

	const schemaType = schema.type;

	// Array type: coerce empty object to empty array
	if (schemaType === 'array') {
		if (typeof value === 'object' && value !== null) {
			if (Array.isArray(value)) {
				// Already array, coerce items if schema has items
				if (schema.items) {
					return value.map(item => coerceToSchema(item, schema.items!));
				}
				return value;
			}
			// Object with numeric keys (Lua table) or empty object
			const keys = Object.keys(value);
			if (keys.length === 0) {
				// Empty object -> empty array
				return [];
			}
			// Check if all keys are numeric (Lua array-like table)
			const isNumericKeys = keys.every(k => /^\d+$/.test(k));
			if (isNumericKeys) {
				const arr = Object.values(value);
				if (schema.items) {
					return arr.map(item => coerceToSchema(item, schema.items!));
				}
				return arr;
			}
		}
		return value;
	}

	// Object type: coerce properties recursively
	if (schemaType === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
		if (schema.properties) {
			const result: Record<string, unknown> = {};
			for (const [key, propSchema] of Object.entries(schema.properties)) {
				if (key in (value as Record<string, unknown>)) {
					result[key] = coerceToSchema((value as Record<string, unknown>)[key], propSchema);
				}
			}
			// Copy additional properties
			for (const key of Object.keys(value as Record<string, unknown>)) {
				if (!(key in result)) {
					result[key] = (value as Record<string, unknown>)[key];
				}
			}
			return result;
		}
		return value;
	}

	return value;
}

/**
 * Coerce service outputs according to output schema.
 * 
 * @param outputs - Raw outputs from Lua service call
 * @param outputSchema - JSON Schema for service outputs
 * @returns Coerced outputs
 */
export function coerceOutputs(
	outputs: Record<string, unknown>,
	outputSchema: JsonSchema
): Record<string, unknown> {
	if (!outputSchema.properties) {
		return outputs;
	}

	const result: Record<string, unknown> = {};
	for (const [key, propSchema] of Object.entries(outputSchema.properties)) {
		if (key in outputs) {
			result[key] = coerceToSchema(outputs[key], propSchema);
		}
	}
	// Copy additional properties not in schema
	for (const key of Object.keys(outputs)) {
		if (!(key in result)) {
			result[key] = outputs[key];
		}
	}
	return result;
}

/**
 * Extract the iterator yield type from a streaming service's output schema.
 * 
 * Streaming services have a single output with x-function: true and x-returns schema.
 * 
 * @param outputSchema - Service output schema
 * @returns The schema for each yielded value, or null if not found
 */
export function getIteratorYieldSchema(outputSchema: JsonSchema): JsonSchema | null {
	if (!outputSchema.properties) return null;
	
	const propKeys = Object.keys(outputSchema.properties);
	if (propKeys.length !== 1) return null;
	
	const iteratorSchema = outputSchema.properties[propKeys[0]];
	if (!iteratorSchema?.['x-function'] || !iteratorSchema['x-returns']) {
		return null;
	}
	
	return iteratorSchema['x-returns'] as JsonSchema;
}
