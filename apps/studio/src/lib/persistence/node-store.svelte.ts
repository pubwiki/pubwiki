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
 * After content-hash-realtime-update refactoring:
 * - contentHash is tracked in real-time via VersionService
 * - Content changes automatically mark version as dirty
 * - Async getters for contentHash/commit guarantee freshness
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
import { versionService } from '../version/version-service.svelte';

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
  
  // Name-to-ID index for fast lookup by name
  private nameIndex = new Map<string, string>();
  
  private projectId: string = '';
  private dirty = new Set<string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  
  // Historical version cache (key: `${nodeId}:${commit}`)
  private versionCache = new Map<string, StudioNodeData>();
  
  // Reactive modification counter - increments whenever any node is modified
  // Components can use $derived to react to changes
  private _modificationCount = $state(0);
  
  constructor() {
    // Inject callbacks into VersionService
    versionService.setCallbacks(
      (nodeId, updates) => this.applyVersionUpdates(nodeId, updates),
      (nodeId) => this.data.get(nodeId)
    );
  }
  
  /**
   * Apply version updates from VersionService.
   * Internal method, does not trigger dirty marking (version already updated).
   */
  private applyVersionUpdates(nodeId: string, updates: Partial<StudioNodeData>): void {
    const current = this.data.get(nodeId);
    if (!current) return;
    
    const updated = { ...current, ...updates } as StudioNodeData;
    this.data.set(nodeId, updated);
    this.dirty.add(nodeId);
    this.notifyNode(nodeId);
    // Note: scheduleSave() not called here - existing save mechanism handles it
  }
  
  /**
   * Get the current modification count (reactive)
   * Use this to subscribe to any node store changes.
   * Example: $derived(nodeStore.modificationCount && nodeStore.getAll())
   */
  get modificationCount(): number {
    return this._modificationCount;
  }
  
  /**
   * Notify that a modification has occurred
   */
  private notifyModification(): void {
    this._modificationCount++;
  }
  
  /**
   * Notify subscribers of a specific node
   */
  private notifyNode(nodeId: string): void {
    const current = this.versions.get(nodeId) ?? 0;
    this.versions.set(nodeId, current + 1);
  }
  
  /**
   * Update the name index when a node's name changes
   */
  private updateNameIndex(nodeId: string, oldName: string | undefined, newName: string | undefined): void {
    // Remove old name from index
    if (oldName && this.nameIndex.get(oldName) === nodeId) {
      this.nameIndex.delete(oldName);
    }
    // Add new name to index
    if (newName) {
      this.nameIndex.set(newName, nodeId);
    }
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
    this.nameIndex.clear();
    this.dirty.clear();
    this.versionCache.clear();  // Clear version cache on project change
    
    // Load from IndexedDB
    const storedData = await db.nodeData.where('projectId').equals(projectId).toArray();
    console.log('[NodeStore] Loaded', storedData.length, 'nodes from IndexedDB');
    
    for (const stored of storedData) {
      const nodeData = this.deserialize(stored);
      this.data.set(stored.nodeId, nodeData);
      this.versions.set(stored.nodeId, 0);
      // Build name index
      if (nodeData.name) {
        this.nameIndex.set(nodeData.name, nodeData.id);
      }
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
  
  // ============================================================================
  // Version Management (via VersionService)
  // ============================================================================
  
  /**
   * Get node's contentHash (guaranteed up-to-date).
   * 
   * If content has changed since last sync, this will compute and return
   * the new contentHash. Use this instead of directly accessing node.contentHash
   * when you need the authoritative value.
   */
  async getContentHash(nodeId: string): Promise<string | undefined> {
    if (!this.data.has(nodeId)) return undefined;
    return versionService.getContentHash(nodeId);
  }
  
  /**
   * Get node's commit (guaranteed up-to-date).
   * 
   * Ensures contentHash is up-to-date first, then returns the commit.
   * Use this instead of directly accessing node.commit when you need
   * the authoritative value.
   */
  async getCommit(nodeId: string): Promise<string | undefined> {
    if (!this.data.has(nodeId)) return undefined;
    return versionService.getCommit(nodeId);
  }
  
  /**
   * Ensure all specified nodes have up-to-date versions.
   * 
   * Used by operations that need accurate version info for multiple nodes,
   * like prepareForGeneration() or publish().
   */
  async ensureVersionsSynced(nodeIds: string[]): Promise<void> {
    await versionService.ensureSynced(nodeIds);
  }
  
  /**
   * Save a snapshot of node data to the snapshots table.
   * 
   * Automatically ensures contentHash/commit are up-to-date before saving.
   * 
   * @param nodeId - The node ID to snapshot
   * @param options - Optional position and incoming edges to save with snapshot
   */
  async saveSnapshot(
    nodeId: string,
    options?: {
      position?: SnapshotPosition;
      incomingEdges?: SnapshotEdge[];
    }
  ): Promise<void> {
    await versionService.saveSnapshot(nodeId, options);
    
    // Also update version cache with fresh data
    const nodeData = this.data.get(nodeId);
    if (nodeData) {
      const cacheKey = `${nodeData.id}:${nodeData.commit}`;
      this.versionCache.set(cacheKey, nodeData);
    }
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
  
  // ============================================================================
  // Name-based Lookup Methods
  // ============================================================================
  
  /**
   * Get node data by name
   * 
   * @param name - The node name to look up
   * @returns The node data if found, undefined otherwise
   */
  getByName(name: string): StudioNodeData | undefined {
    const nodeId = this.nameIndex.get(name);
    if (!nodeId) return undefined;
    return this.get(nodeId);
  }
  
  /**
   * Get node ID by name
   * 
   * @param name - The node name to look up
   * @returns The node ID if found, undefined otherwise
   */
  getIdByName(name: string): string | undefined {
    return this.nameIndex.get(name);
  }
  
  /**
   * Check if a name is already taken
   * 
   * @param name - The name to check
   * @param excludeNodeId - Optional node ID to exclude (for editing existing nodes)
   * @returns true if the name is taken, false otherwise
   */
  isNameTaken(name: string, excludeNodeId?: string): boolean {
    const existingId = this.nameIndex.get(name);
    if (!existingId) return false;
    if (excludeNodeId && existingId === excludeNodeId) return false;
    return true;
  }
  
  // ============================================================================
  // Mutation Methods
  // ============================================================================
  
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
    
    // Update name index if name changed
    if (current.name !== updated.name) {
      this.updateNameIndex(nodeId, current.name, updated.name);
    }
    
    // Detect content change (reference comparison)
    const contentChanged = updated.content !== current.content;
    
    this.data.set(nodeId, updated);
    this.dirty.add(nodeId);
    // Notify only this node's subscribers
    this.notifyNode(nodeId);
    this.notifyModification();
    this.scheduleSave();
    
    // If content changed, mark version as dirty
    if (contentChanged) {
      versionService.markDirty(nodeId);
    }
  }
  
  /**
   * Set node data directly (replaces existing or creates new)
   * 
   * @param nodeId - The node ID to set
   * @param data - The node data to set
   */
  set(nodeId: string, data: StudioNodeData): void {
    const existing = this.data.get(nodeId);
    
    // Update name index
    if (existing?.name !== data.name) {
      this.updateNameIndex(nodeId, existing?.name, data.name);
    }
    
    // Detect content change
    const contentChanged = !existing || existing.content !== data.content;
    
    this.data.set(nodeId, data);
    this.dirty.add(nodeId);
    // Notify this node's subscribers
    this.notifyNode(nodeId);
    this.notifyModification();
    this.scheduleSave();
    
    // If content changed, mark version as dirty
    if (contentChanged) {
      versionService.markDirty(nodeId);
    }
  }
  
  /**
   * Set node data transiently (no persistence)
   * Use this for phantom/temporary nodes that should not be saved to IndexedDB.
   * 
   * @param nodeId - The node ID to set
   * @param data - The node data to set
   */
  setTransient(nodeId: string, data: StudioNodeData): void {
    const existing = this.data.get(nodeId);
    
    // Update name index
    if (existing?.name !== data.name) {
      this.updateNameIndex(nodeId, existing?.name, data.name);
    }
    
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
    
    // Add to name index
    if (data.name) {
      this.nameIndex.set(data.name, data.id);
    }
    
    this.data.set(data.id, data);
    this.dirty.add(data.id);
    // Notify this node's subscribers (also triggers global due to new key)
    this.notifyNode(data.id);
    this.notifyModification();
    this.scheduleSave();
  }
  
  /**
   * Delete a node
   * 
   * @param nodeId - The node ID to delete
   */
  delete(nodeId: string): void {
    const existing = this.data.get(nodeId);
    if (!existing) {
      console.warn('[NodeStore] Cannot delete non-existent node:', nodeId);
      return;
    }
    
    console.log('[NodeStore] Deleting node:', nodeId);
    
    // Remove from name index
    if (existing.name && this.nameIndex.get(existing.name) === nodeId) {
      this.nameIndex.delete(existing.name);
    }
    
    this.data.delete(nodeId);
    this.dirty.delete(nodeId);
    // Remove version entry and notify (triggers global due to key removal)
    this.versions.delete(nodeId);
    this.notifyModification();
    
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
   * 
   * In the new version control architecture:
   * - No more external/originalRef fields
   * - nodeId is globally unique and preserved on import
   * - parent is single commit string (matches cloud schema)
   * - contentHash is stored for validation
   */
  private serialize(data: StudioNodeData): StoredNodeData {
    return {
      projectId: this.projectId,
      nodeId: data.id,
      type: data.type,
      name: data.name,
      commit: data.commit,
      contentHash: data.contentHash,
      parent: data.parent,
      content: data.content.toJSON(),
      timestamp: Date.now()
    };
  }
  
  /**
   * Deserialize storage format to node data
   * 
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
      contentHash: stored.contentHash,
      snapshotRefs: [],  // snapshotRefs managed separately, not persisted
      parent: stored.parent,
      content: restoreContent(nodeType, stored.content)
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
    
    // Clean up version service state
    versionService.dispose();
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
