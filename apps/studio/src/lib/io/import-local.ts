/**
 * Local Import Utilities for Studio
 *
 * Functions to import workspace projects from local ZIP files.
 * 
 * Expected ZIP format:
 * - manifest.json: Project metadata and graph structure
 * - nodes/<nodeId>/data.json: Node business data
 * - nodes/<nodeId>/files/*: VFS files (for VFS nodes only)
 * - nodes/<nodeId>/state.json: Full RDF state (for STATE nodes only)
 */

import type { Edge } from '@xyflow/svelte';
import type { StudioNodeData, VFSNodeData } from '../types';
import type { StoredProject, StoredNodeData, StoredLayout } from '../persistence/db';
import { db, saveProject } from '../persistence/db';
import { restoreContent, type NodeType, VFSContent, GeneratedContent } from '../types/content';
import type { NodeRef } from '../version';
import { getNodeVfs } from '../vfs';
import { getNodeRDFStore } from '../rdf';
import JSZip from 'jszip';
import type { ExportManifest, ExportedNodeData } from './export-local';
import { createIdMapping, remapGeneratedContent, remapNodeRef, type IdMap } from './remap';

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
  
  // First pass: read all node data and create ID mapping
  const exportedNodes: { originalNodeId: string; exportedNode: ExportedNodeData }[] = [];
  for (const { nodeId, file } of nodeDataFiles) {
    const dataText = await file.async('text');
    const exportedNode: ExportedNodeData = JSON.parse(dataText);
    exportedNodes.push({ originalNodeId: nodeId, exportedNode });
  }
  
  // Create ID mapping from old node IDs to new UUIDs
  const idMap: IdMap = createIdMapping(exportedNodes.map(n => ({ id: n.exportedNode.id })));
  
  // Prepare node data and layouts for batch insert
  const nodesToInsert: StoredNodeData[] = [];
  const layoutsToInsert: StoredLayout[] = [];
  
  for (const { originalNodeId, exportedNode } of exportedNodes) {
    // Get the new node ID from the mapping
    const newNodeId = idMap.get(exportedNode.id) ?? exportedNode.id;
    
    // Restore content to proper class instance
    let content = restoreContent(exportedNode.type as NodeType, exportedNode.content);
    
    // For VFS nodes, update projectId to the new project
    if (exportedNode.type === 'VFS') {
      content = new VFSContent(newProjectId);
    }
    
    // For GENERATED nodes, remap content references
    if (exportedNode.type === 'GENERATED' && content instanceof GeneratedContent) {
      content = remapGeneratedContent(content, idMap);
    }
    
    // Convert parents to NodeRef format with remapped IDs
    const parents: NodeRef[] = (exportedNode.parents ?? []).map(p => 
      remapNodeRef(p, idMap)
    );
    
    // Create StoredNodeData for direct DB insert
    const storedNode: StoredNodeData = {
      projectId: newProjectId,
      nodeId: newNodeId,
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
    
    // For VFS nodes, import files (use new node ID for storage)
    if (exportedNode.type === 'VFS' && exportedNode.files && !exportedNode.external) {
      const vfs = await getNodeVfs(newProjectId, newNodeId);
      
      for (const filePath of exportedNode.files) {
        // Find the file in the ZIP (using original node ID from ZIP structure)
        const zipPath = `nodes/${originalNodeId}/files${filePath.startsWith('/') ? filePath : '/' + filePath}`;
        const vfsFile = zip.file(zipPath);
        
        if (vfsFile) {
          const fileContent = await vfsFile.async('arraybuffer');
          await vfs.createFile(filePath, fileContent);
        }
      }
    }
    
    // For STATE nodes, import full RDF state (use new node ID for storage)
    if (exportedNode.type === 'STATE' && exportedNode.hasStateExport) {
      const stateZipPath = `nodes/${originalNodeId}/state.json`;
      const stateFile = zip.file(stateZipPath);
      
      if (stateFile) {
        try {
          const stateData = await stateFile.async('text');
          const store = await getNodeRDFStore(newNodeId);
          await store.importFullState(stateData);
        } catch (e) {
          console.warn(`[Import] Failed to import state for node ${newNodeId}:`, e);
        }
      }
    }
  }
  
  // Import layouts with remapped node IDs
  for (const layout of manifest.layouts) {
    const newNodeId = idMap.get(layout.nodeId) ?? layout.nodeId;
    layoutsToInsert.push({
      projectId: newProjectId,
      nodeId: newNodeId,
      x: layout.x,
      y: layout.y
    });
  }
  
  // Import edges - generate new IDs and remap source/target node IDs
  const edges: Edge[] = manifest.edges.map(e => ({
    id: crypto.randomUUID(), // Generate new ID for each edge
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
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
