/**
 * Save Status Tracker
 *
 * A lightweight global reactive tracker that aggregates save status from
 * multiple independent subsystems (nodeStore, edges, metadata, etc.).
 *
 * Each subsystem calls {@link reportSaveState} to report its current state.
 * UI components call {@link getSaveStatus} (reactive) to read the overall status.
 *
 * This avoids prop-drilling save status through component hierarchies.
 */

import { SvelteMap } from 'svelte/reactivity';

export type SaveState = 'dirty' | 'saving' | 'idle';

const sources = new SvelteMap<string, SaveState>();

/**
 * Report the save state of a named source.
 *
 * @param source - Unique name for the save source (e.g. 'nodes', 'edges', 'metadata')
 * @param state  - 'dirty' (has unsaved changes), 'saving' (flush in progress), 'idle' (all saved)
 */
export function reportSaveState(source: string, state: SaveState): void {
  if (state === 'idle') {
    sources.delete(source);
  } else {
    sources.set(source, state);
  }
}

/**
 * Get the overall local save status (reactive).
 *
 * Priority: saving > unsaved > saved.
 * Use inside $derived or template expressions to establish reactive dependency.
 */
export function getSaveStatus(): 'saved' | 'saving' | 'unsaved' {
  let hasDirty = false;
  for (const state of sources.values()) {
    if (state === 'saving') return 'saving';
    if (state === 'dirty') hasDirty = true;
  }
  return hasDirty ? 'unsaved' : 'saved';
}
