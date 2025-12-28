/**
 * Studio Persistence - Unified exports
 */

export {
  // Database instance and types
  db,
  StudioDatabase,
  type StoredSnapshot,
  type StoredSnapshotEdge,
  type StoredPosition,
  type StoredNode,
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
  
  // Node operations
  nodeToStored,
  storedToNode,
  saveNodes,
  getNodes,
  updateNode,
  deleteNode,
  
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
  
  // Helper functions
  remapNodeIds,
  saveGraph,
  loadGraph,
  
  // Live queries
  liveNodes,
  liveEdges,
  liveSnapshots,
  liveProjects
} from './db';
