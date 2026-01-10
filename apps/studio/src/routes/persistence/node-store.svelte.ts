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
 * 
 * After version-store-unification:
 * - Unified version storage (current + historical versions)
 * - Historical versions accessed via async getVersion(nodeId, commit)
 * - Snapshots saved via saveSnapshot()
 */

import { db, type StoredNodeData, type StoredSnapshotEdge, type StoredPosition } from './db';
import { restoreContent, type NodeType, type NodeContent } from '../types/content';
import type { NodeRef, SnapshotEdge, SnapshotPosition } from '../version/types';
import type { StudioNodeData } from '../types';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a content hash for version control using SHA-256
 * Returns first 16 hex characters of the hash for brevity
 */
export async function generateCommitHash(content: unknown): Promise<string> {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 16);
}

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
  // Internal data storage for current versions
  private data = new Map<string, StudioNodeData>();
  private projectId: string = '';
  private dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  
  // Historical version cache (key: `${nodeId}:${commit}`)
  private versionCache = new Map<string, StudioNodeData>();
  
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
    this.versionCache.clear();  // Clear version cache on project change
    
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
   * Get node data by ID (reactive, synchronous)
   * 
   * For current version only. Use getVersion() for historical versions.
   * Components should use $derived(nodeStore.get(id)) to establish reactivity.
   */
  get(nodeId: string): StudioNodeData | undefined {
    // Access version to establish dependency tracking
    this._version;
    return this.data.get(nodeId);
  }
  
  /**
   * Get node data at a specific version (async)
   * 
   * @param nodeId - Node ID
   * @param commit - Optional commit hash. If not provided, returns current version.
   * @returns StudioNodeData with content restored as class instance
   */
  async getVersion(nodeId: string, commit?: string): Promise<StudioNodeData | undefined> {
    if (!commit) {
      // Return current version (synchronous path)
      this._version;
      return this.data.get(nodeId);
    }
    
    // Check if current version matches the requested commit
    const current = this.data.get(nodeId);
    if (current && current.commit === commit) {
      return current;
    }
    
    // Check version cache
    const cacheKey = `${nodeId}:${commit}`;
    if (this.versionCache.has(cacheKey)) {
      return this.versionCache.get(cacheKey);
    }
    
    // Load from IndexedDB snapshots table
    const stored = await db.snapshots.get([nodeId, commit]);
    if (!stored) return undefined;
    
    // Deserialize to StudioNodeData with content restored as class instance
    const nodeData = this.deserialize(stored);
    this.versionCache.set(cacheKey, nodeData);
    return nodeData;
  }
  
  /**
   * Save a snapshot of node data to the snapshots table
   * 
   * @param nodeData - The node data to snapshot
   * @param options - Optional position and incoming edges to save with snapshot
   */
  async saveSnapshot(
    nodeData: StudioNodeData,
    options?: {
      position?: SnapshotPosition;
      incomingEdges?: SnapshotEdge[];
    }
  ): Promise<void> {
    const stored: StoredNodeData = {
      projectId: '',  // Snapshots are global, not project-specific
      nodeId: nodeData.id,
      commit: nodeData.commit,
      type: nodeData.type,
      name: nodeData.name,
      parents: [],
      content: nodeData.content.toJSON(),
      timestamp: Date.now(),
      incomingEdges: options?.incomingEdges?.map(e => ({
        source: e.source,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      })),
      position: options?.position
    };
    await db.snapshots.put(stored);
    
    // Also update version cache
    const cacheKey = `${nodeData.id}:${nodeData.commit}`;
    this.versionCache.set(cacheKey, nodeData);
  }
  
  /**
   * Check if a snapshot exists
   */
  async hasSnapshot(nodeId: string, commit: string): Promise<boolean> {
    // Check cache first
    if (this.versionCache.has(`${nodeId}:${commit}`)) {
      return true;
    }
    // Check current version
    const current = this.data.get(nodeId);
    if (current && current.commit === commit) {
      return true;
    }
    // Check database
    const count = await db.snapshots.where('[nodeId+commit]').equals([nodeId, commit]).count();
    return count > 0;
  }
  
  /**
   * Get all historical versions for a node, sorted by timestamp
   */
  async getHistory(nodeId: string): Promise<StudioNodeData[]> {
    const snapshots = await db.snapshots.where('nodeId').equals(nodeId).sortBy('timestamp');
    return snapshots.map(s => this.deserialize(s));
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
      parents: data.parents,
      content: data.content.toJSON(),
      external: data.external,
      timestamp: Date.now()
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
      snapshotRefs: [],  // snapshotRefs managed separately, not persisted
      parents: stored.parents ?? [],
      content: restoreContent(nodeType, stored.content),
      external: stored.external ?? false
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
    this.versionCache.clear();
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
