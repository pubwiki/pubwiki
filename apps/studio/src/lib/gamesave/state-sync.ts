/**
 * Save Store - Reactive store for managing STATE node saves
 * 
 * In the new architecture, saves are queried by stateNodeId + stateNodeCommit.
 * This store provides a reactive interface for managing save lists per STATE node version.
 */

import { SvelteMap } from 'svelte/reactivity';
import type { SaveDetail } from '@pubwiki/api';
import { fetchSaves } from './checkpoint';

/**
 * Reactive store for managing saves per STATE node version.
 * 
 * Key: `${stateNodeId}:${stateNodeCommit}`
 * Value: Array of SaveDetail
 */
class SaveStore {
  private saves = new SvelteMap<string, SaveDetail[]>();
  private loading = new SvelteMap<string, boolean>();
  
  /**
   * Get cache key for a STATE node version
   */
  private getKey(stateNodeId: string, stateNodeCommit: string): string {
    return `${stateNodeId}:${stateNodeCommit}`;
  }
  
  /**
   * Fetch saves from the backend for a STATE node version.
   * Updates the reactive store with results.
   * 
   * @param stateNodeId - STATE node ID
   * @param stateNodeCommit - STATE node commit hash
   * @returns List of saves
   */
  async fetch(stateNodeId: string, stateNodeCommit: string): Promise<SaveDetail[]> {
    const key = this.getKey(stateNodeId, stateNodeCommit);
    
    // Mark as loading
    this.loading.set(key, true);
    
    try {
      const saves = await fetchSaves(stateNodeId, stateNodeCommit);
      this.saves.set(key, saves);
      return saves;
    } finally {
      this.loading.set(key, false);
    }
  }
  
  /**
   * Get cached saves for a STATE node version.
   * Returns empty array if not cached.
   * This establishes reactivity - components using this will update when saves change.
   * 
   * @param stateNodeId - STATE node ID
   * @param stateNodeCommit - STATE node commit hash
   * @returns Cached saves or empty array
   */
  get(stateNodeId: string, stateNodeCommit: string): SaveDetail[] {
    const key = this.getKey(stateNodeId, stateNodeCommit);
    return this.saves.get(key) ?? [];
  }
  
  /**
   * Check if saves are currently being fetched
   */
  isLoading(stateNodeId: string, stateNodeCommit: string): boolean {
    const key = this.getKey(stateNodeId, stateNodeCommit);
    return this.loading.get(key) ?? false;
  }
  
  /**
   * Add a save to the cached list (after creating a new save)
   */
  add(stateNodeId: string, stateNodeCommit: string, save: SaveDetail): void {
    const key = this.getKey(stateNodeId, stateNodeCommit);
    const existing = this.saves.get(key) ?? [];
    this.saves.set(key, [...existing, save]);
  }
  
  /**
   * Remove a save from the cached list (after deleting)
   */
  remove(stateNodeId: string, stateNodeCommit: string, commit: string): void {
    const key = this.getKey(stateNodeId, stateNodeCommit);
    const existing = this.saves.get(key) ?? [];
    this.saves.set(key, existing.filter(s => s.commit !== commit));
  }
  
  /**
   * Clear cache for a STATE node version
   */
  clear(stateNodeId: string, stateNodeCommit: string): void {
    const key = this.getKey(stateNodeId, stateNodeCommit);
    this.saves.delete(key);
    this.loading.delete(key);
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
