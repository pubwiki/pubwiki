/**
 * Layout Store
 * 
 * Manages node position data, separated from business data.
 * Auto-saves to IndexedDB with debouncing.
 * 
 * Design:
 * - Only stores position (x, y) per node
 * - Decoupled from business data (NodeStore handles that)
 * - Triggered by SvelteFlow drag events
 */

import { db, type StoredLayout } from './db';

// ============================================================================
// Types
// ============================================================================

export interface NodeLayout {
  x: number;
  y: number;
}

// ============================================================================
// Layout Store Class
// ============================================================================

/**
 * Global layout store for node positions
 * 
 * Manages rendering positions, decoupled from business data.
 */
class LayoutStore {
  private layouts = new Map<string, NodeLayout>();
  private projectId: string = '';
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  
  /**
   * Initialize the store with a project's layouts
   * 
   * @param projectId - The project ID to load layouts for
   * @returns Map of node positions (for initial SvelteFlow setup)
   */
  async init(projectId: string): Promise<Map<string, NodeLayout>> {
    console.log('[LayoutStore] Initializing for project:', projectId);
    
    // Flush any pending saves from previous project
    await this.save();
    
    this.projectId = projectId;
    this.layouts.clear();
    this.dirty = false;
    
    // Load from IndexedDB
    const storedLayouts = await db.layouts.where('projectId').equals(projectId).toArray();
    console.log('[LayoutStore] Loaded', storedLayouts.length, 'layouts from IndexedDB');
    
    for (const layout of storedLayouts) {
      this.layouts.set(layout.nodeId, { x: layout.x, y: layout.y });
    }
    
    this.initialized = true;
    
    // Return a copy of the layouts map
    return new Map(this.layouts);
  }
  
  /**
   * Check if store is initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
  
  /**
   * Get layout for a node
   */
  get(nodeId: string): NodeLayout | undefined {
    return this.layouts.get(nodeId);
  }
  
  /**
   * Get all layouts
   */
  getAll(): Map<string, NodeLayout> {
    return new Map(this.layouts);
  }
  
  /**
   * Batch update layouts (called from onnodedragstop / onselectiondragstop)
   * 
   * @param updates - Array of { nodeId, x, y } updates
   */
  updateMany(updates: Array<{ nodeId: string; x: number; y: number }>): void {
    for (const { nodeId, x, y } of updates) {
      this.layouts.set(nodeId, { x, y });
    }
    this.dirty = true;
    this.scheduleSave();
  }
  
  /**
   * Update a single layout
   */
  update(nodeId: string, x: number, y: number): void {
    this.layouts.set(nodeId, { x, y });
    this.dirty = true;
    this.scheduleSave();
  }
  
  /**
   * Add a new node layout
   */
  add(nodeId: string, x: number, y: number): void {
    console.log('[LayoutStore] Adding layout for node:', nodeId, { x, y });
    this.layouts.set(nodeId, { x, y });
    this.dirty = true;
    this.scheduleSave();
  }
  
  /**
   * Delete a node layout
   */
  delete(nodeId: string): void {
    console.log('[LayoutStore] Deleting layout for node:', nodeId);
    this.layouts.delete(nodeId);
    
    // Immediately delete from database
    db.layouts.where({ projectId: this.projectId, nodeId }).delete().catch(err => {
      console.error('[LayoutStore] Failed to delete layout from DB:', err);
    });
  }
  
  /**
   * Schedule a debounced save
   */
  private scheduleSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    this.saveTimer = setTimeout(() => this.save(), 500);
  }
  
  /**
   * Save all layouts to IndexedDB
   */
  async save(): Promise<void> {
    if (!this.dirty || !this.projectId) return;
    
    console.log('[LayoutStore] Saving layouts to IndexedDB');
    
    const toSave: StoredLayout[] = Array.from(this.layouts.entries()).map(([nodeId, pos]) => ({
      projectId: this.projectId,
      nodeId,
      x: pos.x,
      y: pos.y
    }));
    
    try {
      await db.transaction('rw', db.layouts, async () => {
        // Delete existing layouts for this project
        await db.layouts.where('projectId').equals(this.projectId).delete();
        // Insert new layouts
        if (toSave.length > 0) {
          await db.layouts.bulkPut(toSave);
        }
      });
      console.log('[LayoutStore] Saved', toSave.length, 'layouts successfully');
    } catch (err) {
      console.error('[LayoutStore] Failed to save layouts:', err);
    }
    
    this.dirty = false;
  }
  
  /**
   * Force immediate save (useful before navigation)
   */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.save();
  }
  
  /**
   * Clear all data (for cleanup/testing)
   */
  clear(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.layouts.clear();
    this.dirty = false;
    this.projectId = '';
    this.initialized = false;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Global layout store instance
 * 
 * Usage in +page.svelte:
 * ```svelte
 * <script>
 *   import { layoutStore } from '../persistence/layout-store';
 *   
 *   // On drag stop, update layouts
 *   function handleNodeDragStop(event) {
 *     const updates = event.nodes.map(n => ({
 *       nodeId: n.id,
 *       x: n.position.x,
 *       y: n.position.y
 *     }));
 *     layoutStore.updateMany(updates);
 *   }
 * </script>
 * ```
 */
export const layoutStore = new LayoutStore();
