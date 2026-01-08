/**
 * Studio Persistence - Unified exports
 * 
 * Version 2: Layer Separation Architecture
 * - NodeStore: Business data (content, commit, snapshotRefs, etc.)
 * - LayoutStore: Rendering positions (x, y)
 * - Edges: Graph structure (separate from node data)
 */

// ============================================================================
// Database and Types
// ============================================================================

export {
  // Database instance and types
  db,
  StudioDatabase,
  type StoredSnapshot,
  type StoredSnapshotEdge,
  type StoredPosition,
  type StoredLayout,
  type StoredNodeData,
  type StoredEdge,
  type StoredProject,
  
  // Current project management
  getCurrentProject,
  setCurrentProject,
  clearCurrentProject,
  
  // Snapshot operations
  addSnapshot,
  getSnapshot,
  getSnapshotsByNodeId,
  hasSnapshot,
  removeSnapshot,
  removeSnapshotsByNodeId,
  getAllSnapshots,
  importSnapshots,
  clearSnapshots,
  
  // Edge operations
  edgeToStored,
  storedToEdge,
  saveEdges,
  getEdges,
  updateEdge,
  deleteEdge,
  
  // Project operations
  saveProject,
  getProject,
  getAllProjects,
  deleteProject,
  ensureProject,
  
  // Live queries
  liveEdges,
  liveSnapshots,
  liveProjects
} from './db';

// ============================================================================
// Stores (New Layer Separation)
// ============================================================================

export { nodeStore, type StudioNodeData } from './node-store.svelte';
export { layoutStore, type NodeLayout } from './layout-store';
