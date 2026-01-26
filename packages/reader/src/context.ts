/**
 * Reader Context
 *
 * Provides context for Reader component to pass down to child nodes.
 * Uses Svelte's context API to decouple routing/link generation from components.
 */

import type { GameRef } from '@pubwiki/api';

/** Context key for Reader context */
export const READER_CONTEXT_KEY = Symbol('reader-context');

/**
 * Reader context interface
 *
 * The buildPlaybackUrl callback allows callers to define their own URL generation logic,
 * decoupling the Reader component from specific routing implementations.
 */
export interface ReaderContext {
	/**
	 * Build playback URL for a game reference
	 * Return null/undefined to hide the playback button
	 */
	buildPlaybackUrl?: (gameRef: GameRef) => string | null | undefined;
}
