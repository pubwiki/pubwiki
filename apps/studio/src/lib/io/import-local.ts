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
 * - nodes/<nodeId>/snapshots.json: Historical snapshots
 * 
 * After version control refactoring:
 * - Node IDs are preserved (globally unique UUIDs, no remapping)
 * - No more external/originalRef distinction
 * - Snapshot history is restored from export file
 */

import type { Edge } from '@xyflow/svelte';
import type { StoredProject, StoredNodeData, StoredLayout } from '../persistence/db';
import { db, saveProject } from '../persistence/db';
import { restoreContent, type NodeType, VFSContent, StateContent } from '../types/content';
import { getNodeVfs } from '../vfs';
import { getNodeRDFStore } from '../rdf';
import { computeContentHash, computeNodeCommit } from '@pubwiki/api';
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
export function selectZipFile(): Promise<File | null> {
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
 * In the new version control architecture:
 * - Node IDs are preserved (no remapping)
 * - Snapshot history is restored if present in export
 * - No external/originalRef handling
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
  
  // Validate manifest format
  if (manifest.version !== 1) {
    throw new Error(`Invalid export file: unrecognized format`);
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
  
  // Prepare node data, layouts, and snapshots for batch insert
  const nodesToInsert: StoredNodeData[] = [];
  const layoutsToInsert: StoredLayout[] = [];
  const snapshotsToInsert: StoredNodeData[] = [];
  
  for (const { nodeId, file } of nodeDataFiles) {
    const dataText = await file.async('text');
    const exportedNode: ExportedNodeData = JSON.parse(dataText);
    
    // Preserve original node ID (no remapping)
    const preservedNodeId = exportedNode.id;
    
    // Restore content to proper class instance
    let content = restoreContent(exportedNode.type as NodeType, exportedNode.content);
    
    // For VFS nodes, update projectId to the new project
    if (exportedNode.type === 'VFS') {
      content = new VFSContent(newProjectId);
    }
    
    // For STATE nodes, ensure content name matches node name
    if (exportedNode.type === 'STATE' && content instanceof StateContent) {
      content = content.withName(exportedNode.name || 'State');
    }
    
    // Recompute contentHash from actual content (the exported value may be
    // stale or undefined, especially for VFS nodes whose content changed).
    const contentJson = content.toJSON();
    const contentHash = await computeContentHash(
      contentJson as Parameters<typeof computeContentHash>[0]
    );
    const commit = await computeNodeCommit(
      preservedNodeId,
      exportedNode.parent,
      contentHash,
      exportedNode.type,
      exportedNode.metadata
    );
    
    // Create StoredNodeData for direct DB insert
    const storedNode: StoredNodeData = {
      projectId: newProjectId,
      nodeId: preservedNodeId,
      type: exportedNode.type as NodeType,
      name: exportedNode.name,
      commit,
      contentHash,
      parent: exportedNode.parent,
      content: contentJson,
      timestamp: Date.now(),
      metadata: exportedNode.metadata
    };
    
    nodesToInsert.push(storedNode);
    nodeCount++;
    
    // For VFS nodes, import files
    if (exportedNode.type === 'VFS' && exportedNode.files) {
      const vfs = await getNodeVfs(newProjectId, preservedNodeId);
      
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
    
    // For STATE nodes, import full RDF state
    if (exportedNode.type === 'STATE' && exportedNode.hasStateExport) {
      const stateZipPath = `nodes/${nodeId}/state.json`;
      const stateFile = zip.file(stateZipPath);
      
      if (stateFile) {
        try {
          const stateData = await stateFile.async('text');
          const store = await getNodeRDFStore(preservedNodeId);
          store.importState(JSON.parse(stateData));
        } catch (e) {
          console.warn(`[Import] Failed to import state for node ${preservedNodeId}:`, e);
        }
      }
    }
    
    // Import snapshot history if present
    if (exportedNode.snapshots && exportedNode.snapshots.length > 0) {
      for (const snapshot of exportedNode.snapshots) {
        const snapshotContent = restoreContent(exportedNode.type as NodeType, snapshot.content);
        const snapshotData: StoredNodeData = {
          projectId: '', // Snapshots are global
          nodeId: preservedNodeId,
          type: exportedNode.type as NodeType,
          name: exportedNode.name,
          commit: snapshot.commit,
          contentHash: snapshot.contentHash,
          parent: snapshot.parent,
          content: snapshotContent.toJSON(),
          timestamp: snapshot.timestamp,
          incomingEdges: snapshot.incomingEdges,
          position: snapshot.position,
          metadata: snapshot.metadata
        };
        snapshotsToInsert.push(snapshotData);
      }
    }
  }
  
  // Import layouts - preserve node IDs
  for (const layout of manifest.layouts) {
    layoutsToInsert.push({
      projectId: newProjectId,
      nodeId: layout.nodeId, // No remapping
      x: layout.x,
      y: layout.y
    });
  }
  
  // Import edges - preserve source/target IDs, generate new edge IDs
  const edges: Edge[] = manifest.edges.map(e => ({
    id: crypto.randomUUID(), // Generate new edge ID only
    source: e.source, // No remapping
    target: e.target, // No remapping
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle
  }));
  
  // Write all data directly to IndexedDB in a single transaction
  console.log('[Import] Writing to IndexedDB:', nodeCount, 'nodes,', layoutsToInsert.length, 'layouts,', edges.length, 'edges,', snapshotsToInsert.length, 'snapshots');
  
  await db.transaction('rw', [db.nodeData, db.layouts, db.edges, db.snapshots], async () => {
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
        id: e.id,
        projectId: newProjectId,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle
      }));
      await db.edges.bulkPut(storedEdges);
    }
    
    // Insert snapshots (historical versions)
    if (snapshotsToInsert.length > 0) {
      await db.snapshots.bulkPut(snapshotsToInsert);
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
