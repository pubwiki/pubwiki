/**
 * Local Export Utilities for Studio
 *
 * Functions to export workspace projects to local ZIP files.
 * 
 * Export format (ZIP):
 * - manifest.json: Project metadata and graph structure
 * - nodes/<nodeId>/data.json: Node business data
 * - nodes/<nodeId>/files/*: VFS files (for VFS nodes only)
 * - nodes/<nodeId>/state.json: Full RDF state (for STATE nodes only)
 */

import type { Edge } from '@xyflow/svelte';
import type { StudioNodeData, VFSNodeData, StateNodeData } from '../types';
import type { StoredProject, StoredLayout } from '../persistence/db';
import { nodeStore, layoutStore, getProject, getEdges } from '../persistence';
import { getNodeVfs } from '../vfs';
import { getNodeRDFStore } from '../rdf';
import JSZip from 'jszip';

// ============================================================================
// Export Format Types
// ============================================================================

/**
 * Export manifest format
 */
export interface ExportManifest {
  /** Export format version */
  version: number;
  /** Export timestamp */
  exportedAt: string;
  /** Project metadata */
  project: {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    artifactId?: string;
    isDraft: boolean;
  };
  /** Node layout positions */
  layouts: Array<{
    nodeId: string;
    x: number;
    y: number;
  }>;
  /** Graph edges */
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
}

/**
 * Exported node data format
 */
export interface ExportedNodeData {
  id: string;
  type: string;
  name: string;
  commit: string;
  parents: Array<{ id: string; commit: string }>;
  content: unknown;
  external?: boolean;
  /** For VFS nodes: list of file paths */
  files?: string[];
  /** For STATE nodes: indicates full state is exported separately */
  hasStateExport?: boolean;
}

// ============================================================================
// VFS File Collection
// ============================================================================

interface VfsFileInfo {
  path: string;
  content: Uint8Array;
}

/**
 * Collect all files with content from a VFS node
 */
async function collectVfsFiles(
  projectId: string,
  nodeId: string
): Promise<VfsFileInfo[]> {
  const vfs = await getNodeVfs(projectId, nodeId);
  const files: VfsFileInfo[] = [];

  async function collectRecursive(path: string): Promise<void> {
    const items = await vfs.listFolder(path);
    for (const item of items) {
      if ('folderPath' in item) {
        // It's a file - read its content
        const file = await vfs.readFile(item.path);
        if (file.content) {
          const content = typeof file.content === 'string'
            ? new TextEncoder().encode(file.content)
            : new Uint8Array(file.content);
          files.push({ path: item.path, content });
        }
      } else {
        // It's a folder, recurse into it
        await collectRecursive(item.path);
      }
    }
  }

  try {
    await collectRecursive('/');
  } catch {
    // VFS might be empty or not initialized
  }

  return files;
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export a project to a ZIP file and trigger download
 * 
 * @param projectId - The project ID to export
 * @returns Promise that resolves when download is triggered
 */
export async function exportProjectToZip(projectId: string): Promise<void> {
  const zip = new JSZip();
  
  // Get project metadata
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }
  
  // Get edges
  const edges = await getEdges(projectId);
  console.log('[Export] Got edges from DB:', edges.length, 'edges for project:', projectId);
  
  // Get all node data
  const nodes = nodeStore.getAll();
  console.log('[Export] Got nodes from store:', nodes.length, 'nodes');
  
  // Get all layouts
  const layouts = layoutStore.getAll();
  
  // Create manifest
  const manifest: ExportManifest = {
    version: 1,
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      artifactId: project.artifactId,
      isDraft: project.isDraft
    },
    layouts: Array.from(layouts.entries()).map(([nodeId, pos]) => ({
      nodeId,
      x: pos.x,
      y: pos.y
    })),
    edges: edges.map(edge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle
    }))
  };
  
  // Add manifest to zip
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  
  // Create nodes folder
  const nodesFolder = zip.folder('nodes');
  if (!nodesFolder) {
    throw new Error('Failed to create nodes folder in ZIP');
  }
  
  // Export each node
  for (const node of nodes) {
    const nodeFolder = nodesFolder.folder(node.id);
    if (!nodeFolder) continue;
    
    // Create node data
    const nodeData: ExportedNodeData = {
      id: node.id,
      type: node.type,
      name: node.name,
      commit: node.commit,
      parents: node.parents,
      content: node.content.toJSON(),
      external: node.external
    };
    
    // For VFS nodes, collect and add files
    if (node.type === 'VFS' && !node.external) {
      const vfsNode = node as VFSNodeData;
      const files = await collectVfsFiles(vfsNode.content.projectId, node.id);
      
      nodeData.files = files.map(f => f.path);
      
      // Add VFS files to the node folder
      const filesFolder = nodeFolder.folder('files');
      if (filesFolder) {
        for (const file of files) {
          // Remove leading slash for ZIP path
          const zipPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
          filesFolder.file(zipPath, file.content);
        }
      }
    }
    
    // For STATE nodes, export full RDF state
    if (node.type === 'STATE') {
      try {
        const store = await getNodeRDFStore(node.id);
        const stateData = await store.exportFullState();
        nodeFolder.file('state.json', stateData);
        nodeData.hasStateExport = true;
      } catch (e) {
        // State might be empty or not initialized, skip
        console.warn(`[Export] Failed to export state for node ${node.id}:`, e);
      }
    }
    
    // Add node data.json
    nodeFolder.file('data.json', JSON.stringify(nodeData, null, 2));
  }
  
  // Generate ZIP blob and trigger download
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(project.name)}.pubwiki.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Sanitize a filename by removing invalid characters
 */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 100) || 'project';
}
