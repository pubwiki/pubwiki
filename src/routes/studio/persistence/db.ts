/**
 * Studio Database
 * 
 * Dexie-based IndexedDB persistence for Studio nodes, edges, and snapshots.
 * Designed for integration with Svelte 5 runes via liveQuery.
 */

import Dexie, { type EntityTable, liveQuery, type Observable } from 'dexie';
import type { Edge, Node } from '@xyflow/svelte';
import { restoreContent, type NodeType, type NodeContent } from '../types/content';

// Type constraint for Node data with content (required for serialization)
interface NodeDataWithContent extends Record<string, unknown> {
  type: NodeType;
  content: NodeContent;
}

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
 * Serializes content using toJSON() for proper class serialization
 */
export function nodeToStored<T extends NodeDataWithContent>(node: Node<T>, projectId: string = DEFAULT_PROJECT_ID): StoredNode {
  // Serialize content to JSON-safe format
  const serializedData = {
    ...node.data,
    content: node.data.content.toJSON()
  };
  
  return {
    id: node.id,
    projectId,
    type: node.type ?? 'default',
    positionX: node.position?.x ?? 0,
    positionY: node.position?.y ?? 0,
    data: serializedData
  };
}

/**
 * Convert StoredNode to XYFlow Node
 * Restores content class instance using restoreContent()
 */
export function storedToNode<T extends NodeDataWithContent>(stored: StoredNode): Node<T> {
  const rawData = stored.data as Record<string, unknown>;
  const nodeType = rawData.type as NodeType;
  
  // Restore content class instance from JSON
  const restoredData = {
    ...rawData,
    content: restoreContent(nodeType, rawData.content)
  } as T;
  
  return {
    id: stored.id,
    type: stored.type,
    position: { x: stored.positionX, y: stored.positionY },
    data: restoredData
  };
}

/**
 * Save nodes to database (replaces all nodes for a project)
 */
export async function saveNodes<T extends NodeDataWithContent>(nodes: Node<T>[], projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
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
export async function getNodes<T extends NodeDataWithContent>(projectId: string = DEFAULT_PROJECT_ID): Promise<Node<T>[]> {
  const stored = await db.nodes.where('projectId').equals(projectId).toArray();
  return stored.map(s => storedToNode<T>(s));
}

/**
 * Update a single node
 */
export async function updateNode<T extends NodeDataWithContent>(node: Node<T>, projectId: string = DEFAULT_PROJECT_ID): Promise<void> {
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
 * Save entire graph state (nodes + edges) atomically
 */
export async function saveGraph<T extends NodeDataWithContent>(
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
export async function loadGraph<T extends NodeDataWithContent>(
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
export function liveNodes<T extends NodeDataWithContent>(projectId: string = DEFAULT_PROJECT_ID): Observable<Node<T>[]> {
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
