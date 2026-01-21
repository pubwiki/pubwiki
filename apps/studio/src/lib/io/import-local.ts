/**
 * Local Import Utilities for Studio
 *
 * Functions to import workspace projects from local ZIP files.
 * 
 * Expected ZIP format:
 * - manifest.json: Project metadata and graph structure
 * - nodes/<nodeId>/data.json: Node business data
 * - nodes/<nodeId>/files/*: VFS files (for VFS nodes only)
 */

import type { Edge } from '@xyflow/svelte';
import type { StudioNodeData, VFSNodeData } from '../types';
import type { StoredProject, StoredNodeData, StoredLayout } from '../persistence/db';
import { db, saveProject } from '../persistence/db';
import { restoreContent, type NodeType, VFSContent } from '../types/content';
import type { NodeRef } from '../version';
import { getNodeVfs } from '../vfs';
import JSZip from 'jszip';
import type { ExportManifest, ExportedNodeData } from './export-local';

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Import result
 */
export interface ImportResult {
  projectId: string;
  projectName: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Open file dialog and import a project from ZIP
 * 
 * @returns Promise with import result, or null if cancelled
 */
export async function importProjectFromZip(): Promise<ImportResult | null> {
  // Create file input and trigger selection
  const file = await selectZipFile();
  if (!file) {
    return null;
  }
  
  return importFromZipFile(file);
}

/**
 * Open file selection dialog
 */
function selectZipFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,.pubwiki.zip';
    
    input.onchange = () => {
      const file = input.files?.[0];
      resolve(file ?? null);
    };
    
    input.oncancel = () => {
      resolve(null);
    };
    
    input.click();
  });
}

/**
 * Import a project from a ZIP file
 * 
 * @param file - The ZIP file to import
 * @returns Promise with import result
 */
export async function importFromZipFile(file: File): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(file);
  
  // Read and parse manifest
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error('Invalid export file: manifest.json not found');
  }
  
  const manifestText = await manifestFile.async('text');
  const manifest: ExportManifest = JSON.parse(manifestText);
  
  // Validate manifest version
  if (manifest.version !== 1) {
    throw new Error(`Unsupported export format version: ${manifest.version}`);
  }
  
  // Generate new project ID to avoid conflicts
  const newProjectId = crypto.randomUUID();
  
  // Create project record
  const project: StoredProject = {
    id: newProjectId,
    name: manifest.project.name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    artifactId: undefined, // Don't preserve artifact ID on import
    isDraft: true // Always start as draft
  };
  
  await saveProject(project);
  
  // IMPORTANT: Do NOT call nodeStore.init or layoutStore.init here!
  // That would affect the currently open project's state.
  // Instead, write directly to IndexedDB.
  
  // Import nodes
  const nodesFolder = zip.folder('nodes');
  if (!nodesFolder) {
    throw new Error('Invalid export file: nodes folder not found');
  }
  
  let nodeCount = 0;
  
  // Find all node folders (they have data.json inside)
  const nodeDataFiles: { nodeId: string; file: JSZip.JSZipObject }[] = [];
  nodesFolder.forEach((relativePath, file) => {
    const match = relativePath.match(/^([^/]+)\/data\.json$/);
    if (match) {
      nodeDataFiles.push({ nodeId: match[1], file });
    }
  });
  
  // Prepare node data and layouts for batch insert
  const nodesToInsert: StoredNodeData[] = [];
  const layoutsToInsert: StoredLayout[] = [];
  
  for (const { nodeId, file } of nodeDataFiles) {
    const dataText = await file.async('text');
    const exportedNode: ExportedNodeData = JSON.parse(dataText);
    
    // Restore content to proper class instance
    let content = restoreContent(exportedNode.type as NodeType, exportedNode.content);
    
    // For VFS nodes, update projectId to the new project
    if (exportedNode.type === 'VFS') {
      content = new VFSContent(newProjectId);
    }
    
    // Convert parents to NodeRef format
    const parents: NodeRef[] = (exportedNode.parents ?? []).map(p => ({
      id: p.id,
      commit: p.commit
    }));
    
    // Create StoredNodeData for direct DB insert
    const storedNode: StoredNodeData = {
      projectId: newProjectId,
      nodeId: exportedNode.id,
      type: exportedNode.type as NodeType,
      name: exportedNode.name,
      commit: exportedNode.commit,
      parents,
      content: content.toJSON(),
      external: exportedNode.external,
      timestamp: Date.now()
    };
    
    nodesToInsert.push(storedNode);
    nodeCount++;
    
    // For VFS nodes, import files
    if (exportedNode.type === 'VFS' && exportedNode.files && !exportedNode.external) {
      const vfs = await getNodeVfs(newProjectId, exportedNode.id);
      
      for (const filePath of exportedNode.files) {
        // Find the file in the ZIP
        const zipPath = `nodes/${nodeId}/files${filePath.startsWith('/') ? filePath : '/' + filePath}`;
        const vfsFile = zip.file(zipPath);
        
        if (vfsFile) {
          const fileContent = await vfsFile.async('arraybuffer');
          await vfs.createFile(filePath, fileContent);
        }
      }
    }
  }
  
  // Import layouts
  for (const layout of manifest.layouts) {
    layoutsToInsert.push({
      projectId: newProjectId,
      nodeId: layout.nodeId,
      x: layout.x,
      y: layout.y
    });
  }
  
  // Import edges - generate new IDs to avoid conflicts with other projects
  const edges: Edge[] = manifest.edges.map(e => ({
    id: crypto.randomUUID(), // Generate new ID for each edge
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle
  }));
  
  // Write all data directly to IndexedDB in a single transaction
  console.log('[Import] Writing to IndexedDB:', nodeCount, 'nodes,', layoutsToInsert.length, 'layouts,', edges.length, 'edges');
  
  await db.transaction('rw', [db.nodeData, db.layouts, db.edges], async () => {
    // Insert nodes
    if (nodesToInsert.length > 0) {
      await db.nodeData.bulkPut(nodesToInsert);
    }
    
    // Insert layouts
    if (layoutsToInsert.length > 0) {
      await db.layouts.bulkPut(layoutsToInsert);
    }
    
    // Insert edges (saveEdges does delete + insert, so we do the same)
    await db.edges.where('projectId').equals(newProjectId).delete();
    if (edges.length > 0) {
      const storedEdges = edges.map(e => ({
        id: e.id, // Already new UUID from above
        projectId: newProjectId,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      }));
      await db.edges.bulkPut(storedEdges);
    }
  });
  
  console.log('[Import] Import complete, nodeCount:', nodeCount, 'edgeCount:', edges.length);
  
  return {
    projectId: newProjectId,
    projectName: manifest.project.name,
    nodeCount,
    edgeCount: edges.length
  };
}
