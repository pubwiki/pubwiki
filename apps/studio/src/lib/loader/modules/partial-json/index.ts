/**
 * Partial JSON Module for Loader Backend
 *
 * Provides partial JSON parsing functionality for streaming LLM responses.
 * Uses openai-partial-json-parser for robust handling of incomplete JSON.
 */

import { partialParse, PartialJSON, MalformedJSON } from 'openai-partial-json-parser'
import type { JsModuleDefinition } from '../../types'

// Re-export error classes for type checking
export { PartialJSON, MalformedJSON }

// ============================================================================
// Module Factory
// ============================================================================

/**
 * Create a JS module definition for partial JSON parsing
 */
export function createPartialJsonModule(): JsModuleDefinition {
	return {
		/**
		 * Parse a partial JSON string
		 * Uses default settings that allow all partial types except numbers
		 * @param jsonString - The potentially incomplete JSON string
		 * @returns Parsed JSON value
		 * @throws PartialJSON if the JSON is incomplete
		 * @throws MalformedJSON if the JSON is malformed
		 */
		parse(jsonString: string) {
			return partialParse(jsonString)
		}
	}
}
