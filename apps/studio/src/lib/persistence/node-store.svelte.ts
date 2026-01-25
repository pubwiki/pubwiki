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
 * - Reactive via SvelteMap for per-node fine-grained reactivity
 * 
 * After version-store-unification:
 * - Unified version storage (current + historical versions)
 * - Historical versions accessed via async getVersion(nodeId, commit)
 * - Snapshots saved via saveSnapshot()
 * 
 * Reactivity Design:
 * - Uses SvelteMap from svelte/reactivity for per-key fine-grained updates
 * - map.get(nodeId) only subscribes to that specific node
 * - Updating one node only triggers re-renders for components that called get(nodeId)
 */

import { SvelteMap } from 'svelte/reactivity';
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
 * 
 * Reactivity Strategy:
 * - Uses plain Map for actual data storage (no reactivity overhead)
 * - Uses SvelteMap<string, number> for per-key version signals
 * - When get(id) is called, we read versions.get(id) to establish per-key dependency
 * - When set(id) is called, we increment versions.get(id) to notify only that key's subscribers
 * - SvelteMap with number values won't trigger global version updates since numbers compare by value
 */
class NodeStore {
  // Plain Map for data storage (non-reactive)
  private data = new Map<string, StudioNodeData>();
  
  // SvelteMap for per-key version signals
  // Reading versions.get(nodeId) establishes dependency on that specific node
  // Incrementing versions.set(nodeId, n+1) notifies only subscribers of that node
  private versions = new SvelteMap<string, number>();
  
  private projectId: string = '';
  private dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  
  // Historical version cache (key: `${nodeId}:${commit}`)
  private versionCache = new Map<string, StudioNodeData>();
  
  /**
   * Notify subscribers of a specific node
   */
  private notifyNode(nodeId: string): void {
    const current = this.versions.get(nodeId) ?? 0;
    this.versions.set(nodeId, current + 1);
  }
  
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
    this.versions.clear();
    this.dirty.clear();
    this.versionCache.clear();  // Clear version cache on project change
    
    // Load from IndexedDB
    const storedData = await db.nodeData.where('projectId').equals(projectId).toArray();
    console.log('[NodeStore] Loaded', storedData.length, 'nodes from IndexedDB');
    
    for (const stored of storedData) {
      const nodeData = this.deserialize(stored);
      this.data.set(stored.nodeId, nodeData);
      this.versions.set(stored.nodeId, 0);
    }
    
    this.initialized = true;
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
   * Get node data by ID (reactive, per-node granularity)
   * 
   * For current version only. Use getVersion() for historical versions.
   * Components should use $derived(nodeStore.get(id)) to establish reactivity.
   * Only triggers re-render when this specific node changes.
   * 
   * Strategy: Read from versions SvelteMap to establish per-key dependency,
   * then return data from plain Map.
   */
  get(nodeId: string): StudioNodeData | undefined {
    // Read version to establish reactive dependency on this specific node
    this.versions.get(nodeId);
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
      // Return current version - read version for reactivity
      this.versions.get(nodeId);
      return this.data.get(nodeId);
    }
    
    // Check version cache first
    const cacheKey = `${nodeId}:${commit}`;
    if (this.versionCache.has(cacheKey)) {
      return this.versionCache.get(cacheKey);
    }
    
    // Always load from IndexedDB snapshots table for historical versions
    // Don't use current node data even if commit matches - the current content
    // might have been edited without updating the commit
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
   * Get all node IDs (reactive, global granularity)
   * Triggers re-render when any node is added or removed.
   * 
   * Note: Iterating versions.keys() subscribes to structure changes.
   */
  getAllIds(): string[] {
    // Iterate versions to establish dependency on structure changes
    Array.from(this.versions.keys());
    return Array.from(this.data.keys());
  }

  /**
   * Get all nodes (reactive, global granularity)
   * Triggers re-render when any node is added or removed.
   * 
   * Note: Iterating versions subscribes to all changes.
   */
  getAll(): StudioNodeData[] {
    // Iterate versions to establish dependency on all changes
    Array.from(this.versions.values());
    return Array.from(this.data.values());
  }

  /**
   * Check if a node exists (reactive, per-node granularity)
   */
  has(nodeId: string): boolean {
    // Read version to establish per-key dependency
    this.versions.get(nodeId);
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
    // Notify only this node's subscribers
    this.notifyNode(nodeId);
    this.scheduleSave();
  }
  
  /**
   * Set node data directly (replaces existing or creates new)
   * 
   * @param nodeId - The node ID to set
   * @param data - The node data to set
   */
  set(nodeId: string, data: StudioNodeData): void {
    this.data.set(nodeId, data);
    this.dirty.add(nodeId);
    // Notify this node's subscribers
    this.notifyNode(nodeId);
    this.scheduleSave();
  }
  
  /**
   * Set node data transiently (no persistence)
   * Use this for phantom/temporary nodes that should not be saved to IndexedDB.
   * 
   * @param nodeId - The node ID to set
   * @param data - The node data to set
   */
  setTransient(nodeId: string, data: StudioNodeData): void {
    this.data.set(nodeId, data);
    // Notify this node's subscribers
    this.notifyNode(nodeId);
    // Note: not added to dirty set, so won't be persisted
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
    // Notify this node's subscribers (also triggers global due to new key)
    this.notifyNode(data.id);
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
    // Remove version entry and notify (triggers global due to key removal)
    this.versions.delete(nodeId);
    
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
      originalRef: data.originalRef,
      timestamp: Date.now()
    };
  }
  
  /**
   * Deserialize storage format to node data
   * Note: Type assertion is needed because restoreContent returns NodeContent base type,
   * but the specific content type is determined by nodeType. TypeScript can't narrow this automatically.
   * Use 'as unknown as StudioNodeData' because restoreContent returns the correct runtime type.
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
      external: stored.external ?? false,
      originalRef: stored.originalRef
    } as unknown as StudioNodeData;
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
    this.versions.clear();
    this.dirty.clear();
    this.versionCache.clear();
    this.projectId = '';
    this.initialized = false;
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
