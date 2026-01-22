/**
 * Partial JSON Module for Loader Backend
 *
 * Provides partial JSON parsing functionality for streaming LLM responses.
 * Uses openai-partial-json-parser for robust handling of incomplete JSON.
 */

import { jsonrepair } from 'jsonrepair'
import type { JsModuleDefinition } from '../../types'


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
		 * @returns Parsed JSON value or error object(which has _error property) if parsing fails
		 */
		parse(jsonString: string) {
			try {
				return JSON.parse(jsonrepair(jsonString))
			}catch (err) {
				return {_error: 'Failed to parse JSON', details: err}
			}
		}
	}
}
