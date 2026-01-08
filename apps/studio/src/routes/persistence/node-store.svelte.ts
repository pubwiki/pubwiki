/**
 * Node Store
 * 
 * Global store for node business data, separated from rendering state.
 * Uses Svelte 5 runes for reactivity.
 * 
 * Design:
 * - Manages all node business data (content, commit, snapshotRefs, etc.)
 * - Decoupled from SvelteFlow rendering (position, selected, dragging)
 * - Auto-saves to IndexedDB with debouncing
 * - Reactive via Svelte 5 $state
 */

import { db, type StoredNodeData } from './db';
import { restoreContent, type NodeType, type NodeContent } from '../types/content';
import type { NodeRef } from '../version';
import type { StudioNodeData } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * Re-export StudioNodeData as the primary node data type for the store.
 * This is a union type of all concrete node data types.
 * 
 * Note: StudioNodeData members all extend BaseNodeData which has an index signature
 * for Versionable compatibility.
 */
export type { StudioNodeData };

// ============================================================================
// Node Store Class
// ============================================================================

/**
 * Global node data store
 * 
 * Manages all node business data, decoupled from rendering.
 * Uses Svelte 5 $state for reactivity.
 */
class NodeStore {
  // Internal data storage
  private data = new Map<string, StudioNodeData>();
  private projectId: string = '';
  private dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  
  // Svelte 5 reactive state - version counter for triggering updates
  private _version = $state(0);
  
  /**
   * Initialize the store with a project's data
   * 
   * @param projectId - The project ID to load data for
   */
  async init(projectId: string): Promise<void> {
    console.log('[NodeStore] Initializing for project:', projectId);
    
    // Flush any pending saves from previous project
    await this.flush();
    
    this.projectId = projectId;
    this.data.clear();
    this.dirty.clear();
    
    // Load from IndexedDB
    const storedData = await db.nodeData.where('projectId').equals(projectId).toArray();
    console.log('[NodeStore] Loaded', storedData.length, 'nodes from IndexedDB');
    
    for (const stored of storedData) {
      const nodeData = this.deserialize(stored);
      this.data.set(stored.nodeId, nodeData);
    }
    
    this.initialized = true;
    this._version++;
  }
  
  /**
   * Check if store is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Get the current project ID
   */
  get currentProjectId(): string {
    return this.projectId;
  }
  
  /**
   * Get node data by ID (reactive)
   * 
   * Components should use $derived(nodeStore.get(id)) to establish reactivity.
   */
  get(nodeId: string): StudioNodeData | undefined {
    // Access version to establish dependency tracking
    this._version;
    return this.data.get(nodeId);
  }
  
  /**
   * Get all node IDs (reactive)
   */
  getAllIds(): string[] {
    this._version;
    return Array.from(this.data.keys());
  }
  
  /**
   * Get all nodes (reactive)
   */
  getAll(): StudioNodeData[] {
    this._version;
    return Array.from(this.data.values());
  }
  
  /**
   * Check if a node exists
   */
  has(nodeId: string): boolean {
    this._version;
    return this.data.has(nodeId);
  }
  
  /**
   * Update node data with an updater function
   * 
   * @param nodeId - The node ID to update
   * @param updater - Function that receives current data and returns updated data
   */
  update(nodeId: string, updater: (data: StudioNodeData) => StudioNodeData): void {
    const current = this.data.get(nodeId);
    if (!current) {
      console.warn('[NodeStore] Cannot update non-existent node:', nodeId);
      return;
    }
    
    const updated = updater(current);
    this.data.set(nodeId, updated);
    this.dirty.add(nodeId);
    this._version++;
    this.scheduleSave();
  }
  
  /**
   * Set node data directly (replaces existing or creates new)
   * 
   * @param nodeId - The node ID to set
   * @param data - The node data to set
   */
  set(nodeId: string, data: StudioNodeData): void {
    console.log('[NodeStore] Setting node:', nodeId, data.type);
    this.data.set(nodeId, data);
    this.dirty.add(nodeId);
    this._version++;
    this.scheduleSave();
  }
  
  /**
   * Create a new node
   * 
   * @param data - The node data to create
   */
  create(data: StudioNodeData): void {
    if (this.data.has(data.id)) {
      console.warn('[NodeStore] Node already exists:', data.id);
      return;
    }
    
    console.log('[NodeStore] Creating node:', data.id, data.type);
    this.data.set(data.id, data);
    this.dirty.add(data.id);
    this._version++;
    this.scheduleSave();
  }
  
  /**
   * Delete a node
   * 
   * @param nodeId - The node ID to delete
   */
  delete(nodeId: string): void {
    if (!this.data.has(nodeId)) {
      console.warn('[NodeStore] Cannot delete non-existent node:', nodeId);
      return;
    }
    
    console.log('[NodeStore] Deleting node:', nodeId);
    this.data.delete(nodeId);
    this.dirty.delete(nodeId);
    this._version++;
    
    // Immediately delete from database
    db.nodeData.where({ projectId: this.projectId, nodeId }).delete().catch(err => {
      console.error('[NodeStore] Failed to delete node from DB:', err);
    });
  }
  
  /**
   * Schedule a debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.flush(), 500);
  }
  
  /**
   * Immediately save all dirty nodes to IndexedDB
   */
  async flush(): Promise<void> {
    if (this.dirty.size === 0) return;
    
    console.log('[NodeStore] Flushing', this.dirty.size, 'dirty nodes to IndexedDB');
    
    const toSave: StoredNodeData[] = [];
    for (const nodeId of this.dirty) {
      const data = this.data.get(nodeId);
      if (data) {
        toSave.push(this.serialize(data));
      }
    }
    
    if (toSave.length > 0) {
      try {
        await db.nodeData.bulkPut(toSave);
        console.log('[NodeStore] Saved', toSave.length, 'nodes successfully');
      } catch (err) {
        console.error('[NodeStore] Failed to save nodes:', err);
      }
    }
    
    this.dirty.clear();
  }
  
  /**
   * Serialize node data to storage format
   */
  private serialize(data: StudioNodeData): StoredNodeData {
    return {
      projectId: this.projectId,
      nodeId: data.id,
      type: data.type,
      name: data.name,
      commit: data.commit,
      snapshotRefs: data.snapshotRefs,
      parents: data.parents,
      content: data.content.toJSON(),
      external: data.external
    };
  }
  
  /**
   * Deserialize storage format to node data
   * Note: Type assertion is needed because restoreContent returns NodeContent base type,
   * but the specific content type is determined by nodeType. TypeScript can't narrow this automatically.
   */
  private deserialize(stored: StoredNodeData): StudioNodeData {
    const nodeType = stored.type as NodeType;
    return {
      id: stored.nodeId,
      type: nodeType,
      name: stored.name,
      commit: stored.commit,
      snapshotRefs: stored.snapshotRefs,
      parents: stored.parents,
      content: restoreContent(nodeType, stored.content),
      external: stored.external
    } as StudioNodeData;
  }
  
  /**
   * Clear all data (for cleanup/testing)
   */
  clear(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.data.clear();
    this.dirty.clear();
    this.projectId = '';
    this.initialized = false;
    this._version++;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global node store instance
 * 
 * Usage in components:
 * ```svelte
 * <script>
 *   import { nodeStore } from '../persistence/node-store.svelte';
 *   
 *   let { id } = $props();
 *   let nodeData = $derived(nodeStore.get(id));
 *   
 *   function updateContent(newContent) {
 *     nodeStore.update(id, data => ({
 *       ...data,
 *       content: newContent
 *     }));
 *   }
 * </script>
 * ```
 */
export const nodeStore = new NodeStore();
