/**
 * Dexie Live Query - Svelte 5 Runes Integration
 * 
 * Provides reactive state from Dexie liveQuery using Svelte 5 $state.
 * This bridges IndexedDB with Svelte's reactivity system.
 */

import { liveQuery, type Observable } from 'dexie';
import { untrack } from 'svelte';

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a live query with loading/error states
 */
export interface LiveQueryResult<T> {
  /** Current data (undefined while loading) */
  readonly data: T | undefined;
  /** Whether the query is still loading */
  readonly loading: boolean;
  /** Error if query failed */
  readonly error: Error | undefined;
}

/**
 * Options for creating a live query
 */
export interface LiveQueryOptions {
  /** Initial data to use before first query completes */
  initialData?: unknown;
}

// ============================================================================
// Core Hook: useLiveQuery
// ============================================================================

/**
 * Create a reactive state from a Dexie liveQuery.
 * 
 * This function subscribes to a Dexie Observable and updates a Svelte 5 $state
 * whenever the underlying IndexedDB data changes.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { useLiveQuery } from './live-query.svelte';
 *   import { db } from './db';
 *   
 *   const nodes = useLiveQuery(
 *     () => db.nodes.where('projectId').equals('default').toArray()
 *   );
 * </script>
 * 
 * {#if nodes.loading}
 *   <p>Loading...</p>
 * {:else if nodes.error}
 *   <p>Error: {nodes.error.message}</p>
 * {:else}
 *   {#each nodes.data ?? [] as node}
 *     <p>{node.id}</p>
 *   {/each}
 * {/if}
 * ```
 * 
 * @param querier - Function that returns a Promise of the data to query
 * @param options - Optional configuration
 * @returns Reactive result with data, loading, and error states
 */
export function useLiveQuery<T>(
  querier: () => T | Promise<T>,
  options: LiveQueryOptions = {}
): LiveQueryResult<T> {
  let data = $state<T | undefined>(options.initialData as T | undefined);
  let loading = $state(true);
  let error = $state<Error | undefined>(undefined);
  
  // Create Observable from querier
  const observable = liveQuery(querier);
  
  // Subscribe to the observable
  const subscription = observable.subscribe({
    next: (value) => {
      data = value;
      loading = false;
      error = undefined;
    },
    error: (err) => {
      error = err instanceof Error ? err : new Error(String(err));
      loading = false;
    }
  });
  
  // Cleanup on component destroy (using Svelte 5 $effect.root or manual cleanup)
  // Note: In Svelte 5, we rely on the component lifecycle
  // The subscription will be garbage collected when the component is destroyed
  // For explicit cleanup, users can call the returned cleanup function
  
  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; }
  };
}

// ============================================================================
// Observable-based Hook
// ============================================================================

/**
 * Subscribe to an existing Dexie Observable.
 * 
 * Use this when you already have an Observable from liveQuery.
 * 
 * @param observable - Dexie Observable to subscribe to
 * @param initialData - Optional initial data
 * @returns Reactive result
 */
export function useObservable<T>(
  observable: Observable<T>,
  initialData?: T
): LiveQueryResult<T> {
  let data = $state<T | undefined>(initialData);
  let loading = $state(true);
  let error = $state<Error | undefined>(undefined);
  
  const subscription = observable.subscribe({
    next: (value) => {
      data = value;
      loading = false;
      error = undefined;
    },
    error: (err) => {
      error = err instanceof Error ? err : new Error(String(err));
      loading = false;
    }
  });
  
  return {
    get data() { return data; },
    get loading() { return loading; },
    get error() { return error; }
  };
}

// ============================================================================
// Mutable State with Persistence
// ============================================================================

/**
 * Result of a persisted state with save/load capabilities
 */
export interface PersistedStateResult<T> {
  /** Current data */
  readonly data: T;
  /** Whether initial load is complete */
  readonly loaded: boolean;
  /** Error if any operation failed */
  readonly error: Error | undefined;
  /** Whether a save operation is in progress */
  readonly saving: boolean;
  /** Update the state and persist to database */
  set(value: T): void;
  /** Update the state using an updater function and persist */
  update(updater: (current: T) => T): void;
  /** Force reload from database */
  reload(): Promise<void>;
}

/**
 * Create a mutable state that persists to IndexedDB.
 * 
 * This is useful for data that needs to be both reactive and editable,
 * like nodes and edges in the flow editor.
 * 
 * @example
 * ```svelte
 * <script lang="ts">
 *   import { usePersistedState } from './live-query.svelte';
 *   import { getNodes, saveNodes } from './db';
 *   
 *   const nodes = usePersistedState(
 *     () => getNodes('default'),
 *     (value) => saveNodes(value, 'default'),
 *     []
 *   );
 * </script>
 * 
 * <button onclick={() => nodes.update(n => [...n, newNode])}>
 *   Add Node
 * </button>
 * ```
 * 
 * @param loader - Function to load initial data from database
 * @param saver - Function to save data to database
 * @param initialValue - Initial value before first load
 * @param options - Additional options
 */
export function usePersistedState<T>(
  loader: () => Promise<T>,
  saver: (value: T) => Promise<void>,
  initialValue: T,
  options: { debounceMs?: number } = {}
): PersistedStateResult<T> {
  let data = $state<T>(initialValue);
  let loaded = $state(false);
  let error = $state<Error | undefined>(undefined);
  let saving = $state(false);
  
  // Debounce timer for saves
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = options.debounceMs ?? 300;
  
  // Load initial data
  async function load() {
    try {
      const result = await loader();
      data = result;
      loaded = true;
      error = undefined;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
    }
  }
  
  // Save data with optional debouncing
  function scheduleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
    }
    
    saveTimer = setTimeout(async () => {
      saving = true;
      try {
        await untrack(() => saver(data));
        error = undefined;
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));
      } finally {
        saving = false;
      }
    }, debounceMs);
  }
  
  // Initial load
  load();
  
  return {
    get data() { return data; },
    get loaded() { return loaded; },
    get error() { return error; },
    get saving() { return saving; },
    
    set(value: T) {
      data = value;
      scheduleSave();
    },
    
    update(updater: (current: T) => T) {
      data = updater(data);
      scheduleSave();
    },
    
    async reload() {
      await load();
    }
  };
}

// ============================================================================
// Graph State (Combined Nodes + Edges)
// ============================================================================

import type { Node, Edge } from '@xyflow/svelte';
import { loadGraph, saveGraph } from './db';

// Type constraint for Node data (required by @xyflow/svelte)
type NodeData = Record<string, unknown>;

/**
 * Result of graph state with persistence
 */
export interface GraphStateResult<T extends NodeData> {
  /** Current nodes */
  readonly nodes: Node<T>[];
  /** Current edges */
  readonly edges: Edge[];
  /** Whether initial load is complete */
  readonly loaded: boolean;
  /** Error if any */
  readonly error: Error | undefined;
  /** Whether saving is in progress */
  readonly saving: boolean;
  
  /** Set nodes */
  setNodes(nodes: Node<T>[]): void;
  /** Set edges */
  setEdges(edges: Edge[]): void;
  /** Update a single node */
  updateNode(id: string, updater: (data: T) => T): void;
  /** Force save (bypasses debounce) */
  forceSave(): Promise<void>;
  /** Reload from database */
  reload(): Promise<void>;
}
