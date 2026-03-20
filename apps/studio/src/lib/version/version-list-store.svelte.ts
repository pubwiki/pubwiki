/* eslint-disable svelte/prefer-svelte-reactivity -- Date/Set used in imperative converters and $derived computations */
/**
 * Version List Store
 * 
 * Manages version history for a node by merging:
 * 1. Local snapshots from IndexedDB (user's local edits)
 * 2. Cloud versions from API (fetched on-demand with scroll-to-load)
 * 
 * Design:
 * - Local snapshots are loaded once during initialization
 * - Cloud versions are loaded page by page via cursor-based pagination
 * - Deduplication: local snapshots take priority over cloud versions
 */

import { db, type StoredNodeData } from '../persistence/db';
import { createApiClient } from '@pubwiki/api/client';
import type { NodeVersionSummary } from '@pubwiki/api';
import { API_BASE_URL } from '$lib/config';

// ============================================================================
// Types
// ============================================================================

/** Extended version info with source indicator */
export interface VersionEntry {
  /** Node ID */
  nodeId: string;
  /** Commit hash */
  commit: string;
  /** Parent commit (null for root) */
  parent: string | null;
  /** Version timestamp */
  timestamp: number;
  /** Commit message */
  message?: string | null;
  /** Semver tag */
  tag?: string | null;
  /** Node name */
  name?: string | null;
  /** Where this version came from */
  source: 'local' | 'cloud';
}

/** Internal state for version list */
interface VersionListState {
  /** Local snapshots from IndexedDB (loaded once) */
  localSnapshots: VersionEntry[];
  /** Cloud versions from API (paginated) */
  cloudVersions: VersionEntry[];
  /** Whether currently loading */
  loading: boolean;
  /** Whether there are more cloud versions to load */
  hasMore: boolean;
  /** Cursor for next cloud page */
  cursor: string | null;
  /** Current node ID being tracked */
  nodeId: string | null;
  /** Error message if any */
  error: string | null;
}

// ============================================================================
// API Client
// ============================================================================

const apiClient = createApiClient(API_BASE_URL);

// ============================================================================
// Store Factory
// ============================================================================

/**
 * Create a version list store for managing node version history.
 * 
 * Usage:
 * ```typescript
 * const versionStore = createVersionListStore();
 * 
 * // Initialize for a node
 * await versionStore.init(nodeId);
 * 
 * // Access merged versions (reactive)
 * const versions = versionStore.mergedVersions;
 * 
 * // Load more when scrolling
 * await versionStore.loadMore();
 * ```
 */
export function createVersionListStore() {
  // Internal state using Svelte 5 runes
  let state = $state<VersionListState>({
    localSnapshots: [],
    cloudVersions: [],
    loading: false,
    hasMore: true,
    cursor: null,
    nodeId: null,
    error: null
  });

  /**
   * Convert StoredNodeData to VersionEntry
   */
  function snapshotToEntry(snap: StoredNodeData): VersionEntry {
    return {
      nodeId: snap.nodeId,
      commit: snap.commit,
      parent: snap.parent,
      timestamp: snap.timestamp ?? 0,
      message: null, // Local snapshots don't have commit messages
      tag: null,
      name: snap.name,
      source: 'local' as const
    };
  }

  /**
   * Convert NodeVersionSummary to VersionEntry
   */
  function cloudVersionToEntry(ver: NodeVersionSummary): VersionEntry {
    return {
      nodeId: ver.nodeId,
      commit: ver.commit,
      parent: ver.parent ?? null,
      timestamp: ver.authoredAt ? new Date(ver.authoredAt).getTime() : 0,
      message: ver.message,
      tag: ver.tag,
      name: ver.name,
      source: 'cloud' as const
    };
  }

  /**
   * Initialize the store for a specific node.
   * Loads all local snapshots and first page of cloud versions.
   */
  async function init(nodeId: string): Promise<void> {
    // Reset state for new node
    state.nodeId = nodeId;
    state.localSnapshots = [];
    state.cloudVersions = [];
    state.hasMore = true;
    state.cursor = null;
    state.error = null;

    // 1. Load all local snapshots from IndexedDB
    try {
      const snapshots = await db.snapshots
        .where('nodeId')
        .equals(nodeId)
        .toArray();
      
      // Sort by timestamp descending (newest first)
      snapshots.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
      state.localSnapshots = snapshots.map(snapshotToEntry);
    } catch (err) {
      console.error('[VersionListStore] Failed to load local snapshots:', err);
      // Continue without local snapshots
    }

    // 2. Load first page of cloud versions
    await loadMore();
  }

  /**
   * Load more cloud versions (scroll-to-load trigger).
   */
  async function loadMore(): Promise<void> {
    if (state.loading || !state.hasMore || !state.nodeId) return;

    state.loading = true;
    state.error = null;

    try {
      const { data, error } = await apiClient.GET('/nodes/{nodeId}/versions', {
        params: {
          path: { nodeId: state.nodeId },
          query: { 
            cursor: state.cursor ?? undefined,
            limit: 20 
          }
        }
      });

      if (error) {
        // Handle 404 or other errors gracefully
        state.error = 'Failed to load cloud versions';
        state.hasMore = false;
        return;
      }

      const newVersions = (data?.versions ?? []).map(cloudVersionToEntry);
      state.cloudVersions = [...state.cloudVersions, ...newVersions];
      state.cursor = data?.nextCursor ?? null;
      state.hasMore = data?.nextCursor != null;
    } catch (err) {
      console.error('[VersionListStore] Failed to load cloud versions:', err);
      state.error = 'Network error loading versions';
      state.hasMore = false;
    } finally {
      state.loading = false;
    }
  }

  /**
   * Reset the store (clear all data).
   */
  function reset(): void {
    state = {
      localSnapshots: [],
      cloudVersions: [],
      loading: false,
      hasMore: true,
      cursor: null,
      nodeId: null,
      error: null
    };
  }

  /**
   * Refresh cloud versions (reload from beginning).
   */
  async function refresh(): Promise<void> {
    if (!state.nodeId) return;
    
    state.cloudVersions = [];
    state.cursor = null;
    state.hasMore = true;
    await loadMore();
  }

  // Computed: merged and deduplicated version list
  const mergedVersions = $derived.by(() => {
    const seen = new Set<string>();
    const result: VersionEntry[] = [];

    // Local snapshots take priority (they are user's local edits)
    for (const snap of state.localSnapshots) {
      seen.add(snap.commit);
      result.push(snap);
    }

    // Add cloud versions that aren't already in local
    for (const ver of state.cloudVersions) {
      if (!seen.has(ver.commit)) {
        result.push(ver);
      }
    }

    // Sort by timestamp descending (newest first)
    return result.sort((a, b) => b.timestamp - a.timestamp);
  });

  return {
    // State accessors
    get loading() { return state.loading; },
    get hasMore() { return state.hasMore; },
    get error() { return state.error; },
    get nodeId() { return state.nodeId; },
    get localSnapshots() { return state.localSnapshots; },
    get cloudVersions() { return state.cloudVersions; },
    get mergedVersions() { return mergedVersions; },

    // Methods
    init,
    loadMore,
    reset,
    refresh
  };
}

export type VersionListStore = ReturnType<typeof createVersionListStore>;
