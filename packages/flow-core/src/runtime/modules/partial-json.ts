/**
 * Partial JSON Module for Loader Backend
 *
 * Provides partial JSON parsing for streaming LLM responses.
 */

import { jsonrepair } from 'jsonrepair';
import type { JsModuleDefinition } from '../types';

export function createPartialJsonModule(): JsModuleDefinition {
	return {
		parse(jsonString: string) {
			try {
				return JSON.parse(jsonrepair(jsonString));
			} catch (err) {
				return { _error: 'Failed to parse JSON', details: err };
			}
		}
	};
}
