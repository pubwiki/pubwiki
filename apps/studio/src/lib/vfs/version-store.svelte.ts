/**
 * VFS Version Store
 * 
 * Provides shared reactive state for VFS version information across components.
 * This allows InputNode, GeneratedNode, and other components to access VFS version
 * state without each needing to create their own VFS controller.
 * 
 * Features:
 * - Reference-counted subscriptions (multiple components can share state)
 * - Reactive state updates via VFS events
 * - Debounced refresh to prevent excessive updates
 */

import type { VfsCommit } from '@pubwiki/vfs';
import { getVfsController, releaseVfsController } from '../../components/nodes/vfs/controller.svelte';

// ============================================================================
// Types
// ============================================================================

export interface VfsVersionState {
  /** Current HEAD commit hash, null if no commits exist */
  headHash: string | null;
  /** Whether there are uncommitted changes */
  hasPendingChanges: boolean;
  /** Recent commit history */
  commits: VfsCommit[];
}

// ============================================================================
// Store Implementation
// ============================================================================

class VfsVersionStore {
  /** Reactive state map: nodeId -> VfsVersionState */
  private _states = $state<Map<string, VfsVersionState>>(new Map());
  
  /** Reference count for each nodeId */
  private _subscriptions = new Map<string, number>();
  
  /** Event unsubscribers for each nodeId */
  private _eventUnsubscribers = new Map<string, Array<() => void>>();
  
  /** Debounce timers for refresh */
  private _refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  
  /** Project IDs for each nodeId (needed for refresh) */
  private _projectIds = new Map<string, string>();

  /**
   * Get the current version state for a VFS node.
   * Returns undefined if not subscribed.
   */
  get(nodeId: string): VfsVersionState | undefined {
    return this._states.get(nodeId);
  }

  /**
   * Subscribe to version state updates for a VFS node.
   * Returns an unsubscribe function.
   * 
   * @param projectId - The project ID containing the VFS
   * @param nodeId - The VFS node ID
   * @returns Unsubscribe function
   */
  async subscribe(projectId: string, nodeId: string): Promise<() => void> {
    const count = this._subscriptions.get(nodeId) ?? 0;
    this._subscriptions.set(nodeId, count + 1);
    this._projectIds.set(nodeId, projectId);
    
    if (count === 0) {
      // First subscriber - initialize state
      await this._initState(projectId, nodeId);
    }
    
    return () => this._unsubscribe(nodeId);
  }

  /**
   * Force refresh the version state for a VFS node.
   * Useful after operations that modify the VFS.
   */
  async refresh(nodeId: string): Promise<void> {
    const projectId = this._projectIds.get(nodeId);
    if (projectId) {
      await this._doRefresh(projectId, nodeId);
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async _initState(projectId: string, nodeId: string) {
    try {
      const controller = await getVfsController(projectId, nodeId);
      const vfs = controller.vfs;
      
      // Get initial state
      const status = await vfs.getStatus();
      let headHash: string | null = null;
      try {
        const head = await vfs.getHead();
        headHash = head.hash;
      } catch {
        // No commits yet
      }
      
      let commits: VfsCommit[] = [];
      try {
        commits = await vfs.getHistory({ depth: 20 });
      } catch {
        // No history yet
      }
      
      // Update reactive state
      const newStates = new Map(this._states);
      newStates.set(nodeId, {
        headHash,
        hasPendingChanges: status.length > 0,
        commits
      });
      this._states = newStates;
      
      // Subscribe to VFS events
      const events = vfs.events;
      const unsubscribers: Array<() => void> = [];
      
      const scheduleRefresh = () => this._scheduleRefresh(projectId, nodeId);
      
      unsubscribers.push(
        events.on('file:created', scheduleRefresh),
        events.on('file:updated', scheduleRefresh),
        events.on('file:deleted', scheduleRefresh),
        events.on('file:moved', scheduleRefresh),
        events.on('folder:created', scheduleRefresh),
        events.on('folder:deleted', scheduleRefresh),
        events.on('folder:moved', scheduleRefresh),
        events.on('version:commit', scheduleRefresh),
        events.on('version:checkout', scheduleRefresh)
      );
      
      this._eventUnsubscribers.set(nodeId, unsubscribers);
    } catch (e) {
      console.error('[VfsVersionStore] Failed to init state for', nodeId, e);
      
      // Set error state
      const newStates = new Map(this._states);
      newStates.set(nodeId, {
        headHash: null,
        hasPendingChanges: false,
        commits: []
      });
      this._states = newStates;
    }
  }

  private _scheduleRefresh(projectId: string, nodeId: string) {
    // Clear existing timer
    const existingTimer = this._refreshTimers.get(nodeId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    // Schedule new refresh with 300ms debounce
    const timer = setTimeout(() => {
      this._refreshTimers.delete(nodeId);
      this._doRefresh(projectId, nodeId);
    }, 300);
    
    this._refreshTimers.set(nodeId, timer);
  }

  private async _doRefresh(projectId: string, nodeId: string) {
    try {
      const controller = await getVfsController(projectId, nodeId);
      const vfs = controller.vfs;
      
      const status = await vfs.getStatus();
      let headHash: string | null = null;
      try {
        const head = await vfs.getHead();
        headHash = head.hash;
      } catch {
        // No commits yet
      }
      
      let commits: VfsCommit[] = [];
      try {
        commits = await vfs.getHistory({ depth: 20 });
      } catch {
        // No history yet
      }
      
      // Update reactive state
      const newStates = new Map(this._states);
      newStates.set(nodeId, {
        headHash,
        hasPendingChanges: status.length > 0,
        commits
      });
      this._states = newStates;
    } catch (e) {
      console.error('[VfsVersionStore] Failed to refresh state for', nodeId, e);
    }
  }

  private _unsubscribe(nodeId: string) {
    const count = this._subscriptions.get(nodeId) ?? 0;
    
    if (count <= 1) {
      // Last subscriber - cleanup
      this._subscriptions.delete(nodeId);
      this._projectIds.delete(nodeId);
      
      // Clear refresh timer
      const timer = this._refreshTimers.get(nodeId);
      if (timer) {
        clearTimeout(timer);
        this._refreshTimers.delete(nodeId);
      }
      
      // Unsubscribe from events
      const unsubscribers = this._eventUnsubscribers.get(nodeId);
      if (unsubscribers) {
        for (const unsub of unsubscribers) {
          unsub();
        }
        this._eventUnsubscribers.delete(nodeId);
      }
      
      // Remove state
      const newStates = new Map(this._states);
      newStates.delete(nodeId);
      this._states = newStates;
      
      // Release controller
      releaseVfsController(nodeId);
    } else {
      this._subscriptions.set(nodeId, count - 1);
    }
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const vfsVersionStore = new VfsVersionStore();
