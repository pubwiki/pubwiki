/**
 * Studio Database
 * 
 * Dexie-based IndexedDB persistence for Studio nodes, edges, and snapshots.
 * Designed for integration with Svelte 5 runes via liveQuery.
 */

import Dexie, { type EntityTable, liveQuery, type Observable } from 'dexie';
import type { Edge, Node } from '@xyflow/svelte';

// Type constraint for Node data (required by @xyflow/svelte)
type NodeData = Record<string, unknown>;

// ============================================================================
// Database Types
// ============================================================================

/**
 * Stored snapshot in IndexedDB
 * Key: composite [nodeId, commit]
 */
export interface StoredSnapshot {
  /** Node ID this snapshot belongs to */
  nodeId: string;
  /** Commit hash (content hash) */
  commit: string;
  /** Snapshot content (JSON serialized) */
  content: unknown;
  /** Timestamp when snapshot was created */
  timestamp: number;
  /** Incoming edges at time of snapshot */
  incomingEdges?: StoredSnapshotEdge[];
  /** Node position at time of snapshot */
  position?: StoredPosition;
}

/**
 * Stored edge in snapshot
 */
export interface StoredSnapshotEdge {
  source: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/**
 * Stored position
 */
export interface StoredPosition {
  x: number;
  y: number;
}

/**
 * Stored node in IndexedDB
 * Flattened structure for storage (Node<StudioNodeData> -> StoredNode)
 */
export interface StoredNode {
  /** Node ID */
  id: string;
  /** Project/workspace ID for multi-project support */
  projectId: string;
  /** Node type: 'prompt' | 'input' | 'generated' */
  type: string;
  /** Position X */
  positionX: number;
  /** Position Y */
  positionY: number;
  /** Node data (JSON serialized) */
  data: unknown;
}

/**
 * Stored edge in IndexedDB
 */
export interface StoredEdge {
  /** Edge ID */
  id: string;
  /** Project/workspace ID */
  projectId: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Source handle */
  sourceHandle?: string | null;
  /** Target handle */
  targetHandle?: string | null;
}

/**
 * Project metadata
 */
export interface StoredProject {
  /** Project ID */
  id: string;
  /** Project name */
  name: string;
  /** Creation timestamp */
  createdAt: number;
  /** Last modified timestamp */
  updatedAt: number;
  /** Associated artifact ID (if published) */
  artifactId?: string;
  /** User ID of the artifact owner */
  userId?: string;
  /** Whether this is a draft (not yet published) */
  isDraft: boolean;
}

// ============================================================================
// Database Definition
// ============================================================================

/**
 * Studio Dexie Database
 */
export class StudioDatabase extends Dexie {
  snapshots!: EntityTable<StoredSnapshot, 'nodeId'>;
  nodes!: EntityTable<StoredNode, 'id'>;
  edges!: EntityTable<StoredEdge, 'id'>;
  projects!: EntityTable<StoredProject, 'id'>;

  constructor() {
    super('StudioDB');
    
    this.version(1).stores({
      // Snapshots: composite key [nodeId, commit], indexed by nodeId for range queries
      snapshots: '[nodeId+commit], nodeId, timestamp',
      // Nodes: indexed by projectId for project-based queries
      nodes: 'id, projectId, type',
      // Edges: indexed by projectId, source and target for graph queries
      edges: 'id, projectId, source, target',
      // Projects: basic metadata
      projects: 'id, createdAt, updatedAt'
    });
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

/** Global database instance */
export const db = new StudioDatabase();

// ============================================================================
// Current Project (localStorage)
// ============================================================================

const CURRENT_PROJECT_KEY = 'studio_current_project';

/**
 * Get the current project ID from localStorage
 */
export function getCurrentProject(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(CURRENT_PROJECT_KEY);
}

/**
 * Set the current project ID in localStorage
 */
export function setCurrentProject(projectId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CURRENT_PROJECT_KEY, projectId);
}

/**
 * Clear the current project from localStorage
 */
export function clearCurrentProject(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(CURRENT_PROJECT_KEY);
}

// ============================================================================
// Snapshot Operations
// ============================================================================

/**
 * Add a snapshot to the database
 */
export async function addSnapshot(snapshot: StoredSnapshot): Promise<void> {
  await db.snapshots.put(snapshot);
}

/**
 * Get a snapshot by nodeId and commit
 */
export async function getSnapshot(nodeId: string, commit: string): Promise<StoredSnapshot | undefined> {
  return db.snapshots.get([nodeId, commit]);
}

/**
 * Get all snapshots for a node, sorted by timestamp
 */
export async function getSnapshotsByNodeId(nodeId: string): Promise<StoredSnapshot[]> {
  return db.snapshots.where('nodeId').equals(nodeId).sortBy('timestamp');
}

/**
 * Check if a snapshot exists
 */
export async function hasSnapshot(nodeId: string, commit: string): Promise<boolean> {
  const count = await db.snapshots.where('[nodeId+commit]').equals([nodeId, commit]).count();
  return count > 0;
}

/**
 * Remove a snapshot
 */
export async function removeSnapshot(nodeId: string, commit: string): Promise<void> {
  await db.snapshots.where('[nodeId+commit]').equals([nodeId, commit]).delete();
}

/**
 * Remove all snapshots for a node
 */
export async function removeSnapshotsByNodeId(nodeId: string): Promise<void> {
  await db.snapshots.where('nodeId').equals(nodeId).delete();
}

/**
 * Get all snapshots (for export)
 */
export async function getAllSnapshots(): Promise<StoredSnapshot[]> {
  return db.snapshots.toArray();
}

/**
 * Import snapshots (bulk insert)
 */
export async function importSnapshots(snapshots: StoredSnapshot[]): Promise<void> {
  await db.snapshots.bulkPut(snapshots);
}

/**
 * Clear all snapshots
 */
export async function clearSnapshots(): Promise<void> {
  await db.snapshots.clear();
}

// ============================================================================
// Node Operations
// ============================================================================

const DEFAULT_PROJECT_ID = 'default';

/**
 * Convert XYFlow Node to StoredNode
 */
export function nodeToStored<T extends NodeData>(node: Node<T>, projectId: string = DEFAULT_PROJECT_ID): StoredNode {
  return {
    id: node.id,
    projectId,
    type: node.type ?? 'default',
    positionX: node.position?.x ?? 0,
    positionY: node.position?.y ?? 0,
    data: node.data
  };
}

/**
 * Convert StoredNode to XYFlow Node
 */
export function storedToNode<T extends NodeData>(stored: StoredNode): Node<T> {
  return {
    id: stored.id,
    type: stored.type,
    position: { x: stored.positionX, y: stored.positionY },
    data: stored.data as T
  };
}

/**
 * Save nodes to database (replaces all nodes for a project)
 */
export async function saveNodes<T extends NodeData>(nodes: Node<T>[], projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  await db.transaction('rw', db.nodes, async () => {
    // Delete existing nodes for this project
    await db.nodes.where('projectId').equals(projectId).delete();
    // Insert new nodes
    const storedNodes = nodes.map(n => nodeToStored(n, projectId));
    await db.nodes.bulkPut(storedNodes);
  });
}

/**
 * Get all nodes for a project
 */
export async function getNodes<T extends NodeData>(projectId: string = DEFAULT_PROJECT_ID): Promise<Node<T>[]> {
  const stored = await db.nodes.where('projectId').equals(projectId).toArray();
  return stored.map(s => storedToNode<T>(s));
}

/**
 * Update a single node
 */
export async function updateNode<T extends NodeData>(node: Node<T>, projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  await db.nodes.put(nodeToStored(node, projectId));
}

/**
 * Delete a node
 */
export async function deleteNode(nodeId: string): Promise<void> {
  await db.nodes.delete(nodeId);
}

// ============================================================================
// Edge Operations
// ============================================================================

/**
 * Convert XYFlow Edge to StoredEdge
 */
export function edgeToStored(edge: Edge, projectId: string = DEFAULT_PROJECT_ID): StoredEdge {
  return {
    id: edge.id,
    projectId,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle
  };
}

/**
 * Convert StoredEdge to XYFlow Edge
 */
export function storedToEdge(stored: StoredEdge): Edge {
  return {
    id: stored.id,
    source: stored.source,
    target: stored.target,
    sourceHandle: stored.sourceHandle,
    targetHandle: stored.targetHandle
  };
}

/**
 * Save edges to database (replaces all edges for a project)
 */
export async function saveEdges(edges: Edge[], projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  await db.transaction('rw', db.edges, async () => {
    // Delete existing edges for this project
    await db.edges.where('projectId').equals(projectId).delete();
    // Insert new edges
    const storedEdges = edges.map(e => edgeToStored(e, projectId));
    await db.edges.bulkPut(storedEdges);
  });
}

/**
 * Get all edges for a project
 */
export async function getEdges(projectId: string = DEFAULT_PROJECT_ID): Promise<Edge[]> {
  const stored = await db.edges.where('projectId').equals(projectId).toArray();
  return stored.map(storedToEdge);
}

/**
 * Update a single edge
 */
export async function updateEdge(edge: Edge, projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
  await db.edges.put(edgeToStored(edge, projectId));
}

/**
 * Delete an edge
 */
export async function deleteEdge(edgeId: string): Promise<void> {
  await db.edges.delete(edgeId);
}

// ============================================================================
// Project Operations
// ============================================================================

/**
 * Create or update a project
 */
export async function saveProject(project: StoredProject): Promise<void> {
  await db.projects.put(project);
}

/**
 * Get a project by ID
 */
export async function getProject(projectId: string): Promise<StoredProject | undefined> {
  return db.projects.get(projectId);
}

/**
 * Get all projects
 */
export async function getAllProjects(): Promise<StoredProject[]> {
  return db.projects.orderBy('updatedAt').reverse().toArray();
}

/**
 * Delete a project and all its data
 */
export async function deleteProject(projectId: string): Promise<void> {
  await db.transaction('rw', [db.projects, db.nodes, db.edges], async () => {
    await db.nodes.where('projectId').equals(projectId).delete();
    await db.edges.where('projectId').equals(projectId).delete();
    await db.projects.delete(projectId);
  });
}


/**
 * Ensure a project exists by ID (creates if not exists)
 */
export async function ensureProject(projectId: string): Promise<StoredProject> {
  let project = await getProject(projectId);
  if (!project) {
    project = {
      id: projectId,
      name: `Project ${projectId.substring(0, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDraft: true
    };
    await saveProject(project);
  }
  return project;
}

// ============================================================================
// Bulk Operations
// ============================================================================

/**
 * Remap node IDs based on server-provided mapping
 * Updates both node.id and node.data.id for non-external nodes
 * Also updates edge source/target references and internal node refs
 */
export function remapNodeIds<T extends NodeData>(
  nodes: Node<T>[],
  edges: Edge[],
  nodeIdMapping: Record<string, string>
): { nodes: Node<T>[]; edges: Edge[] } {
  // Helper to remap a NodeRef
  const remapRef = (ref: { id: string; commit: string }) => ({
    ...ref,
    id: nodeIdMapping[ref.id] ?? ref.id
  });
  
  // Helper to remap an array of NodeRefs
  const remapRefs = (refs?: Array<{ id: string; commit: string }>) => 
    refs?.map(remapRef) ?? [];

  // Create updated nodes
  const updatedNodes = nodes.map(node => {
    const oldId = node.id;
    const newId = nodeIdMapping[oldId];
    const data = node.data as Record<string, unknown>;
    
    // Build the updated data object
    const updatedData = {
      ...data,
      snapshotRefs: remapRefs(data.snapshotRefs as Array<{ id: string; commit: string }> | undefined),
      parents: remapRefs(data.parents as Array<{ id: string; commit: string }> | undefined),
      // For GENERATED nodes
      inputRef: data.inputRef ? remapRef(data.inputRef as { id: string; commit: string }) : undefined,
      promptRefs: remapRefs(data.promptRefs as Array<{ id: string; commit: string }> | undefined),
      indirectPromptRefs: remapRefs(data.indirectPromptRefs as Array<{ id: string; commit: string }> | undefined),
      // For INPUT nodes
      sourcePromptIds: (data.sourcePromptIds as string[] | undefined)?.map(id => nodeIdMapping[id] ?? id)
    };
    
    if (!newId) {
      // No mapping (external node or not in mapping), keep node.id as is
      // But still update internal refs that might point to remapped nodes
      return {
        ...node,
        data: updatedData as unknown as T
      };
    }
    
    // Update both node.id and node.data.id
    return {
      ...node,
      id: newId,
      data: {
        ...updatedData,
        id: newId
      } as unknown as T
    };
  });
  
  // Create updated edges
  const updatedEdges = edges.map(edge => {
    const newSource = nodeIdMapping[edge.source] ?? edge.source;
    const newTarget = nodeIdMapping[edge.target] ?? edge.target;
    
    return {
      ...edge,
      id: `e-${newSource}-${newTarget}`, // Regenerate edge ID
      source: newSource,
      target: newTarget
    };
  });
  
  return { nodes: updatedNodes, edges: updatedEdges };
}

/**
 * Save entire graph state (nodes + edges) atomically
 */
export async function saveGraph<T extends NodeData>(
  nodes: Node<T>[], 
  edges: Edge[], 
  projectId: string = DEFAULT_PROJECT_ID
): Promise<void> {
  await db.transaction('rw', [db.nodes, db.edges, db.projects], async () => {
    // Update project timestamp
    const project = await db.projects.get(projectId);
    if (project) {
      await db.projects.put({ ...project, updatedAt: Date.now() });
    }
    
    // Save nodes
    await db.nodes.where('projectId').equals(projectId).delete();
    const storedNodes = nodes.map(n => nodeToStored(n, projectId));
    await db.nodes.bulkPut(storedNodes);
    
    // Save edges
    await db.edges.where('projectId').equals(projectId).delete();
    const storedEdges = edges.map(e => edgeToStored(e, projectId));
    await db.edges.bulkPut(storedEdges);
  });
}

/**
 * Load entire graph state
 */
export async function loadGraph<T extends NodeData>(
  projectId: string = DEFAULT_PROJECT_ID
): Promise<{ nodes: Node<T>[]; edges: Edge[] }> {
  const [storedNodes, storedEdges] = await Promise.all([
    db.nodes.where('projectId').equals(projectId).toArray(),
    db.edges.where('projectId').equals(projectId).toArray()
  ]);
  
  return {
    nodes: storedNodes.map(s => storedToNode<T>(s)),
    edges: storedEdges.map(storedToEdge)
  };
}

// ============================================================================
// Live Queries (for Svelte 5 integration)
// ============================================================================

/**
 * Create a live query for nodes
 */
export function liveNodes<T extends NodeData>(projectId: string = DEFAULT_PROJECT_ID): Observable<Node<T>[]> {
  return liveQuery(async () => {
    const stored = await db.nodes.where('projectId').equals(projectId).toArray();
    return stored.map(s => storedToNode<T>(s));
  });
}

/**
 * Create a live query for edges
 */
export function liveEdges(projectId: string = DEFAULT_PROJECT_ID): Observable<Edge[]> {
  return liveQuery(async () => {
    const stored = await db.edges.where('projectId').equals(projectId).toArray();
    return stored.map(storedToEdge);
  });
}

/**
 * Create a live query for snapshots of a specific node
 */
export function liveSnapshots(nodeId: string): Observable<StoredSnapshot[]> {
  return liveQuery(async () => {
    return db.snapshots.where('nodeId').equals(nodeId).sortBy('timestamp');
  });
}

/**
 * Create a live query for all projects
 */
export function liveProjects(): Observable<StoredProject[]> {
  return liveQuery(async () => {
    return db.projects.orderBy('updatedAt').reverse().toArray();
  });
}
