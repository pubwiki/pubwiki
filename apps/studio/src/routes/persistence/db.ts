/**
 * Studio Database (v2)
 * 
 * Redesigned for layer separation:
 * - Layouts: Rendering position data (managed by LayoutStore)
 * - NodeData: Business data (managed by NodeStore)
 * - Edges: Graph structure
 * - Projects: Metadata
 * - Snapshots: Version history
 * 
 * Key change: No more `nodes` table with mixed data.
 * Instead, `layouts` and `nodeData` are separate.
 */

import Dexie, { type EntityTable, liveQuery, type Observable } from 'dexie';
import type { Edge } from '@xyflow/svelte';
import { restoreContent, type NodeType, type NodeContent } from '../types/content';
import type { NodeRef } from '../version';

// ============================================================================
// Database Types
// ============================================================================

/**
 * Stored layout in IndexedDB
 * Key: composite [projectId, nodeId]
 */
export interface StoredLayout {
  /** Project ID */
  projectId: string;
  /** Node ID */
  nodeId: string;
  /** Position X */
  x: number;
  /** Position Y */
  y: number;
}

/**
 * Stored node business data in IndexedDB
 * 
 * Used for both:
 * - nodeData table: current node state (key: [projectId, nodeId])
 * - snapshots table: historical versions (key: [nodeId, commit])
 * 
 * For snapshots table, projectId is empty string since snapshots are global.
 */
export interface StoredNodeData {
  /** Project ID (empty for snapshots) */
  projectId: string;
  /** Node ID */
  nodeId: string;
  /** Node type: 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'SANDBOX' | 'LOADER' | 'STATE' */
  type: NodeType;
  /** User-defined node name */
  name: string;
  /** Current commit hash (content hash) */
  commit: string;
  /** Parent nodes that contributed to this node's creation */
  parents: NodeRef[];
  /** Node content (JSON serialized) */
  content: unknown;
  /** Whether this node references external artifact */
  external?: boolean;
  /** Timestamp when this version was created */
  timestamp?: number;
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
// Database Definition (Version 2 - Layer Separation)
// ============================================================================

/**
 * Studio Dexie Database v2
 * 
 * Changes from v1:
 * - Removed `nodes` table
 * - Added `layouts` table for position data
 * - Added `nodeData` table for business data
 */
export class StudioDatabase extends Dexie {
  snapshots!: EntityTable<StoredNodeData, 'nodeId'>;
  layouts!: EntityTable<StoredLayout, 'nodeId'>;
  nodeData!: EntityTable<StoredNodeData, 'nodeId'>;
  edges!: EntityTable<StoredEdge, 'id'>;
  projects!: EntityTable<StoredProject, 'id'>;

  constructor() {
    super('StudioDB');
    
    // Version 2: New schema with layer separation
    // Note: This is a breaking change - old data will be migrated or discarded
    this.version(2).stores({
      // Layouts: position data only
      layouts: '[projectId+nodeId], projectId',
      // NodeData: business data only
      nodeData: '[projectId+nodeId], projectId, type',
      // Snapshots: version history
      snapshots: '[nodeId+commit], nodeId, timestamp',
      // Edges: graph structure
      edges: 'id, projectId, source, target',
      // Projects: metadata
      projects: 'id, createdAt, updatedAt'
    }).upgrade(async tx => {
      // Migration: convert old nodes table to new structure
      // For simplicity, we'll just let the old data be discarded
      // Users can start fresh with the new schema
      console.log('[DB Migration] Upgrading to v2 schema with layer separation');
      
      // Delete old nodes table if it exists (Dexie handles this automatically)
      // The old table will be removed since it's not in the new schema
    });
    
    // Keep v1 for reference (will be upgraded automatically)
    this.version(1).stores({
      snapshots: '[nodeId+commit], nodeId, timestamp',
      nodes: 'id, projectId, type',
      edges: 'id, projectId, source, target',
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
// Edge Operations
// ============================================================================

const DEFAULT_PROJECT_ID = 'default';

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
  await db.transaction('rw', [db.projects, db.layouts, db.nodeData, db.edges], async () => {
    await db.layouts.where('projectId').equals(projectId).delete();
    await db.nodeData.where('projectId').equals(projectId).delete();
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
// Live Queries (for Svelte 5 integration)
// ============================================================================

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
 * Create a live query for all projects
 */
export function liveProjects(): Observable<StoredProject[]> {
  return liveQuery(async () => {
    return db.projects.orderBy('updatedAt').reverse().toArray();
  });
}
