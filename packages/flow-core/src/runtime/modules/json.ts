/**
 * JSON Module for Lua
 *
 * Provides json.encode() and json.decode() for the Lua runtime.
 * Identical to Studio's implementation.
 */

const JSON_NULL = Object.freeze({
	__json_null__: true,
	toString: () => 'null'
});

function jsonReplacer(_key: string, value: unknown): unknown {
	if (value === JSON_NULL) return null;
	return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
	return value;
}

function encode(value: unknown): string {
	if (value === undefined) return 'null';
	try {
		return JSON.stringify(value, jsonReplacer);
	} catch (error) {
		throw new Error(`JSON encode error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function decode(jsonStr: string): unknown {
	try {
		return JSON.parse(jsonStr, jsonReviver);
	} catch (error) {
		throw new Error(`JSON decode error: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function createJsonModule() {
	return { encode, decode, null: JSON_NULL };
}

export { JSON_NULL };
