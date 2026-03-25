/* eslint-disable svelte/prefer-svelte-reactivity -- class fields use Map/Set as internal data structures, not reactive state */
/**
 * Version Service
 * 
 * Core version management logic for studio nodes.
 * 
 * Responsibilities:
 * - Track which nodes need contentHash/commit recalculation (dirty tracking)
 * - Avoid duplicate calculations (pending dedup)
 * - Compute and update contentHash/commit via @pubwiki/flow-core
 * - Manage snapshot storage
 * 
 * Design Principles:
 * - Decoupled from NodeStore, can be independently tested
 * - Does not directly modify NodeStore data, notifies via callback
 * - Uses @pubwiki/flow-core for hash computation (single source of truth)
 * - Debounced background updates + async getter for immediate access
 */

import { computeContentHash, computeNodeCommit } from '@pubwiki/api';
import type { StudioNodeData } from '../types';
import { db } from '../persistence/db';
import type { SnapshotEdge, SnapshotPosition } from './types';

// ============================================================================
// VersionService Class
// ============================================================================

export class VersionService {
  // Nodes whose contentHash needs recalculation
  private dirtyNodes = new Set<string>();
  
  // Pending computation Promises (for deduplication)
  private pendingComputations = new Map<string, Promise<string>>();
  
  // Debounce timer for background updates
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Debounce delay in ms (100ms covers typical streaming intervals of 10-50ms)
  private readonly DEBOUNCE_MS = 100;
  
  // Node data update callback (set by NodeStore)
  private onNodeUpdate: ((nodeId: string, updates: Partial<StudioNodeData>) => void) | null = null;
  
  // Node data getter (set by NodeStore)
  private getNodeData: ((nodeId: string) => StudioNodeData | undefined) | null = null;
  
  /**
   * Set the node update callback and data getter.
   * NodeStore calls this during initialization to inject dependencies.
   */
  setCallbacks(
    onUpdate: (nodeId: string, updates: Partial<StudioNodeData>) => void,
    getData: (nodeId: string) => StudioNodeData | undefined
  ): void {
    this.onNodeUpdate = onUpdate;
    this.getNodeData = getData;
  }
  
  /**
   * Mark a node as dirty (needs contentHash recalculation).
   * Automatically schedules a debounced background update.
   */
  markDirty(nodeId: string): void {
    this.dirtyNodes.add(nodeId);
    this.scheduleBackgroundUpdate();
  }
  
  /**
   * Check if a node is dirty.
   */
  isDirty(nodeId: string): boolean {
    return this.dirtyNodes.has(nodeId);
  }
  
  /**
   * Get a node's contentHash (guaranteed up-to-date).
   * 
   * This is the primary API for accessing contentHash:
   * - If node is clean, returns cached value immediately
   * - If node is dirty, computes and returns the new value
   * - If computation is already in progress, waits for it (dedup)
   * 
   * Callers (like publish) should use this instead of reading contentHash directly.
   */
  async getContentHash(nodeId: string): Promise<string> {
    await this.syncNodeVersion(nodeId);
    return this.getNodeData?.(nodeId)?.contentHash ?? '';
  }
  
  /**
   * Get a node's commit (guaranteed up-to-date).
   * 
   * Ensures contentHash is computed first, then returns commit.
   */
  async getCommit(nodeId: string): Promise<string> {
    await this.syncNodeVersion(nodeId);
    return this.getNodeData?.(nodeId)?.commit ?? '';
  }
  
  /**
   * Internal: Ensure a node's version (contentHash/commit) is up-to-date.
   * 
   * - If node is clean, returns immediately
   * - If node is dirty, computes and updates
   * - If computation is already in progress, waits for it (dedup)
   */
  private async syncNodeVersion(nodeId: string): Promise<void> {
    const nodeData = this.getNodeData?.(nodeId);
    if (!nodeData) {
      return;
    }
    
    // Clean node - already up-to-date (but force recompute if contentHash is missing)
    if (!this.dirtyNodes.has(nodeId) && nodeData.contentHash) {
      return;
    }
    
    // Check for pending computation
    const pending = this.pendingComputations.get(nodeId);
    if (pending) {
      await pending;
      return;
    }
    
    // Start new computation
    const promise = this.computeAndUpdate(nodeId, nodeData);
    this.pendingComputations.set(nodeId, promise);
    
    try {
      await promise;
    } finally {
      this.pendingComputations.delete(nodeId);
    }
  }
  
  /**
   * Internal: Compute and update contentHash and commit.
   */
  private async computeAndUpdate(nodeId: string, nodeData: StudioNodeData): Promise<string> {
    // Compute content hash from NodeContent object
    // Note: toJSON() returns local storage format, cast to API format for hash computation
    // The hash will be based on local storage format fields
    const newContentHash = await computeContentHash(nodeData.content.toJSON() as Parameters<typeof computeContentHash>[0]);
    
    // If hash actually changed
    if (newContentHash !== nodeData.contentHash) {
      const newCommit = await computeNodeCommit(
        nodeId,
        nodeData.parent,
        newContentHash,
        nodeData.type,
        nodeData.metadata as Record<string, string> | undefined
      );
      
      // Notify NodeStore via callback
      if (this.onNodeUpdate) {
        this.onNodeUpdate(nodeId, {
          contentHash: newContentHash,
          commit: newCommit
        });
      }
    }
    
    // Mark as clean
    this.dirtyNodes.delete(nodeId);
    
    return newContentHash;
  }
  
  /**
   * Schedule background update (debounced).
   * 
   * This batches multiple markDirty calls during streaming, computing
   * hashes only after a quiet period.
   */
  private scheduleBackgroundUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    this.debounceTimer = setTimeout(() => {
      this.runBackgroundUpdate();
    }, this.DEBOUNCE_MS);
  }
  
  /**
   * Execute background update for all dirty nodes.
   */
  private async runBackgroundUpdate(): Promise<void> {
    if (this.dirtyNodes.size === 0 || !this.getNodeData) {
      return;
    }
    
    // Copy dirty set (it may be modified during iteration)
    const nodeIds = [...this.dirtyNodes];
    
    // Compute all in parallel
    await Promise.all(
      nodeIds.map(async (nodeId) => {
        const nodeData = this.getNodeData?.(nodeId);
        if (nodeData && this.dirtyNodes.has(nodeId)) {
          await this.computeAndUpdate(nodeId, nodeData);
        }
      })
    );
  }
  
  /**
   * Ensure all specified nodes have up-to-date versions.
   * 
   * Used by operations that need accurate version info for multiple nodes,
   * like prepareForGeneration() or publish().
   * 
   * This cancels any pending debounce and computes immediately.
   */
  async ensureSynced(nodeIds: string[]): Promise<void> {
    // Cancel pending debounce - we're computing now
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    
    // Ensure all nodes are up-to-date
    await Promise.all(
      nodeIds.map(nodeId => this.syncNodeVersion(nodeId))
    );
  }
  
  // ============================================================================
  // Snapshot Management
  // ============================================================================
  
  /**
   * Save node snapshot to IndexedDB.
   * 
   * Automatically ensures contentHash/commit are up-to-date before saving.
   */
  async saveSnapshot(
    nodeId: string,
    options?: {
      position?: SnapshotPosition;
      incomingEdges?: SnapshotEdge[];
    }
  ): Promise<void> {
    // Ensure version is up-to-date before saving
    await this.syncNodeVersion(nodeId);
    
    // Get fresh data after sync
    const nodeData = this.getNodeData?.(nodeId);
    if (!nodeData) {
      throw new Error(`Node ${nodeId} not found`);
    }
    
    const stored = {
      projectId: '',  // Snapshots are global
      nodeId: nodeData.id,
      commit: nodeData.commit,
      contentHash: nodeData.contentHash,
      type: nodeData.type,
      name: nodeData.name,
      parent: nodeData.parent,
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
  }
  
  /**
   * Check if a snapshot exists.
   */
  async hasSnapshot(nodeId: string, commit: string): Promise<boolean> {
    const count = await db.snapshots.where('[nodeId+commit]').equals([nodeId, commit]).count();
    return count > 0;
  }
  
  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.dirtyNodes.clear();
    this.pendingComputations.clear();
    this.onNodeUpdate = null;
    this.getNodeData = null;
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const versionService = new VersionService();
