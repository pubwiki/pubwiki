/**
 * Save Store - Reactive store for managing STATE node saves
 * 
 * In the new architecture, saves are queried by stateNodeId only.
 * This store provides a reactive interface for managing save lists per STATE node.
 */

import { SvelteMap } from 'svelte/reactivity';
import type { SaveDetail } from '@pubwiki/api';
import { fetchSaves } from './checkpoint';

/**
 * Reactive store for managing saves per STATE node.
 * 
 * Key: stateNodeId
 * Value: Array of SaveDetail
 */
class SaveStore {
  private saves = new SvelteMap<string, SaveDetail[]>();
  private loading = new SvelteMap<string, boolean>();
  
  /**
   * Fetch saves from the backend for a STATE node.
   * Updates the reactive store with results.
   * 
   * @param stateNodeId - STATE node ID
   * @returns List of saves
   */
  async fetch(stateNodeId: string): Promise<SaveDetail[]> {
    // Mark as loading
    this.loading.set(stateNodeId, true);
    
    try {
      const saves = await fetchSaves(stateNodeId);
      this.saves.set(stateNodeId, saves);
      return saves;
    } finally {
      this.loading.set(stateNodeId, false);
    }
  }
  
  /**
   * Get cached saves for a STATE node.
   * Returns empty array if not cached.
   * This establishes reactivity - components using this will update when saves change.
   * 
   * @param stateNodeId - STATE node ID
   * @returns Cached saves or empty array
   */
  get(stateNodeId: string): SaveDetail[] {
    return this.saves.get(stateNodeId) ?? [];
  }
  
  /**
   * Check if saves are currently being fetched
   */
  isLoading(stateNodeId: string): boolean {
    return this.loading.get(stateNodeId) ?? false;
  }
  
  /**
   * Add a save to the cached list (after creating a new save)
   */
  add(stateNodeId: string, save: SaveDetail): void {
    const existing = this.saves.get(stateNodeId) ?? [];
    this.saves.set(stateNodeId, [...existing, save]);
  }
  
  /**
   * Remove a save from the cached list (after deleting)
   */
  remove(stateNodeId: string, commit: string): void {
    const existing = this.saves.get(stateNodeId) ?? [];
    this.saves.set(stateNodeId, existing.filter(s => s.commit !== commit));
  }
  
  /**
   * Clear cache for a STATE node
   */
  clear(stateNodeId: string): void {
    this.saves.delete(stateNodeId);
    this.loading.delete(stateNodeId);
  }
  
  /**
   * Clear all cached data
   */
  clearAll(): void {
    this.saves.clear();
    this.loading.clear();
  }
}

/**
 * Singleton save store instance
 */
export const saveStore = new SaveStore();
