/**
 * Studio Import Utilities
 * 
 * Functions for importing artifacts into studio projects.
 * 
 * After version control refactoring:
 * - Node IDs are globally unique UUIDs, preserved on import (no remapping)
 * - parent commit tracks version lineage
 * - No more external/originalRef distinction
 * - Content is included directly in graph response
 * - VFS nodes: download tar.gz archive and extract to VFS storage
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { ArtifactGraphData, ArtifactNodeSummary, ArtifactEdge } from '$lib/types';
import type { 
  StudioNodeData, 
  VFSNodeData, 
  InputNodeData, 
  PromptNodeData, 
  GeneratedNodeData,
  SandboxNodeData,
  LoaderNodeData,
  StateNodeData
} from '../types';
import { 
  InputContent, 
  PromptContent, 
  GeneratedContent, 
  VFSContent,
  SandboxContent,
  LoaderContent,
  StateContent
} from '../types';
import { getNodeVfs } from '../vfs';
import { ensureProject, saveEdges, getEdges, nodeStore, layoutStore } from '../persistence';
import { computeContentHash } from '@pubwiki/flow-core';
import { API_BASE_URL } from '$lib/config';

/**
 * Progress callback for import operations
 */
export type ImportProgressCallback = (progress: {
  phase: 'downloading-vfs' | 'writing-vfs' | 'processing-nodes' | 'saving';
  current?: number;
  total?: number;
  detail?: string;
}) => void;

/**
 * Node summary with content - use type assertion since API types may be slightly different
 * The API now returns content directly in the graph response
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NodeSummaryWithContent = ArtifactNodeSummary & { content?: any; filesSummary?: { totalFiles: number; totalSize: number } };

// ============================================================================
// TAR.GZ Extraction Helpers
// ============================================================================

/**
 * Decompress gzip data using DecompressionStream API
 */
async function gzipDecompress(data: ArrayBuffer): Promise<Uint8Array> {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(data);
  writer.close();
  
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  
  return result;
}

/**
 * Parse a TAR archive and extract files
 * TAR format: 512-byte headers followed by file content padded to 512 bytes
 */
function parseTar(data: Uint8Array): { path: string; content: Uint8Array }[] {
  const files: { path: string; content: Uint8Array }[] = [];
  let offset = 0;
  const decoder = new TextDecoder();
  
  while (offset + 512 <= data.length) {
    // Read 512-byte header
    const header = data.slice(offset, offset + 512);
    
    // Check for end of archive (two empty blocks)
    if (header.every(b => b === 0)) {
      break;
    }
    
    // Extract filename (bytes 0-99)
    const nameBytes = header.slice(0, 100);
    const nameEnd = nameBytes.indexOf(0);
    const name = decoder.decode(nameBytes.slice(0, nameEnd === -1 ? 100 : nameEnd)).trim();
    
    if (!name) {
      break;
    }
    
    // Extract file size (bytes 124-135, octal string)
    const sizeBytes = header.slice(124, 136);
    const sizeStr = decoder.decode(sizeBytes).trim();
    const size = parseInt(sizeStr, 8) || 0;
    
    // Extract type flag (byte 156)
    const typeFlag = header[156];
    
    // Skip to file content
    offset += 512;
    
    // Only process regular files (type '0' or '\0')
    if ((typeFlag === 0x30 || typeFlag === 0) && size > 0) {
      const content = data.slice(offset, offset + size);
      files.push({ path: '/' + name, content: new Uint8Array(content) });
    }
    
    // Skip to next header (content is padded to 512-byte boundary)
    offset += Math.ceil(size / 512) * 512;
  }
  
  return files;
}

/**
 * Fetch and extract VFS archive from API (commit is globally unique key)
 */
async function fetchAndExtractVfsArchive(
  commit: string
): Promise<{ path: string; content: Uint8Array }[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/versions/${commit}/archive`
    );
    if (!response.ok) {
      console.warn(`Failed to fetch VFS archive for commit ${commit}: ${response.status}`);
      return [];
    }
    
    const gzippedData = await response.arrayBuffer();
    const tarData = await gzipDecompress(gzippedData);
    return parseTar(tarData);
  } catch (error) {
    console.error(`Error fetching VFS archive for commit ${commit}:`, error);
    return [];
  }
}

// ============================================================================
// Core Import Functions
// ============================================================================

/**
 * Convert artifact graph data to studio nodes and edges format.
 * 
 * In the new version control architecture:
 * - Node IDs are preserved (globally unique UUIDs)
 * - parent commit is set to track version lineage
 * - No ID remapping needed
 * - No external/originalRef distinction
 * 
 * For VFS nodes: download tar.gz archive and extract to local VFS storage
 */
export async function convertArtifactToStudioGraph(
  graphData: ArtifactGraphData,
  artifactId: string,
  targetProjectId: string,
  onProgress?: ImportProgressCallback
): Promise<{ nodes: Node<StudioNodeData>[]; edges: Edge[] }> {
  // Cast nodes to extended type that includes content
  const nodesWithContent = graphData.nodes as NodeSummaryWithContent[];

  // Process VFS nodes: download tar.gz and extract files in parallel
  // Note: We use the original nodeId now (no remapping)
  const vfsNodes = nodesWithContent.filter((n) => n.type === 'VFS');
  
  if (vfsNodes.length > 0) {
    // Phase 1: Download all VFS archives in parallel
    onProgress?.({ phase: 'downloading-vfs', current: 0, total: vfsNodes.length });
    
    const downloadResults = await Promise.all(
      vfsNodes.map(async (vfsNode, index) => {
        const files = await fetchAndExtractVfsArchive(vfsNode.commit);
        onProgress?.({ 
          phase: 'downloading-vfs', 
          current: index + 1, 
          total: vfsNodes.length,
          detail: vfsNode.name || `VFS ${index + 1}`
        });
        return { vfsNode, files, nodeId: vfsNode.id };
      })
    );
    
    // Phase 2: Write files to VFS storage (must be sequential due to OPFS limitations)
    let writtenCount = 0;
    const totalFiles = downloadResults.reduce((sum, r) => sum + r.files.length, 0);
    onProgress?.({ phase: 'writing-vfs', current: 0, total: totalFiles });
    
    for (const { vfsNode, files, nodeId } of downloadResults) {
      if (files.length > 0) {
        const vfs = await getNodeVfs(targetProjectId, nodeId);
        
        for (const file of files) {
          await vfs.createFile(file.path, new Uint8Array(file.content).buffer as ArrayBuffer);
          writtenCount++;
          if (writtenCount % 10 === 0 || writtenCount === totalFiles) {
            onProgress?.({ 
              phase: 'writing-vfs', 
              current: writtenCount, 
              total: totalFiles,
              detail: vfsNode.name || nodeId.substring(0, 8)
            });
          }
        }
        
        await vfs.commit('Imported from artifact');
      }
    }
  }

  // Phase 3: Process all nodes
  onProgress?.({ phase: 'processing-nodes', current: 0, total: nodesWithContent.length });
  
  const nodes = await Promise.all(nodesWithContent.map(async (node, index) => {
    // Preserve original node ID (globally unique UUID)
    const nodeId = node.id;
    
    // Report progress periodically
    if (index % 5 === 0 || index === nodesWithContent.length - 1) {
      onProgress?.({ phase: 'processing-nodes', current: index + 1, total: nodesWithContent.length });
    }
    
    // Use saved position if available, otherwise calculate a default position (arranged in a grid)
    const posX = node.position?.x ?? ((index % 3) * 300 + 100);
    const posY = node.position?.y ?? (Math.floor(index / 3) * 200 + 100);

    const nodeType = node.type;
    
    // Use the commit from the artifact (this becomes the parent for local edits)
    const commit = node.commit;
    
    // For imported nodes, parent is null (they are the root of local version history)
    // When user edits them locally, new commits will have this imported commit as parent
    const parent: string | null = null;

    // Get content directly from node (already parsed as JSON in graph response)
    const nodeContent = node.content;

    // Handle each node type
    switch (nodeType) {
      case 'VFS': {
        // VFSContent needs projectId, which we set to targetProjectId
        const vfsContent = new VFSContent(targetProjectId);
        const contentHash = await computeContentHash(vfsContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const vfsData: VFSNodeData = {
          id: nodeId,
          name: node.name || `Files ${index + 1}`,
          type: nodeType,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: vfsContent
        };
        return {
          id: nodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: vfsData
        };
      }

      case 'SANDBOX': {
        let parsedContent: SandboxContent;
        if (nodeContent) {
          parsedContent = SandboxContent.fromJSON(nodeContent as Record<string, unknown>);
        } else {
          parsedContent = new SandboxContent();
        }
        const contentHash = await computeContentHash(parsedContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const sandboxData: SandboxNodeData = {
          id: nodeId,
          name: node.name || `Sandbox ${index + 1}`,
          type: nodeType,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: parsedContent
        };
        return {
          id: nodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: sandboxData
        };
      }

      case 'LOADER': {
        let parsedContent: LoaderContent;
        if (nodeContent) {
          parsedContent = LoaderContent.fromJSON(nodeContent as Record<string, unknown>);
        } else {
          parsedContent = new LoaderContent();
        }
        const contentHash = await computeContentHash(parsedContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const loaderData: LoaderNodeData = {
          id: nodeId,
          name: node.name || `Loader ${index + 1}`,
          type: nodeType,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: parsedContent
        };
        return {
          id: nodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: loaderData
        };
      }

      case 'STATE': {
        let stateContent: StateContent;
        if (nodeContent) {
          stateContent = StateContent.fromJSON(nodeContent as Record<string, unknown>);
        } else {
          stateContent = new StateContent();
        }
        const contentHash = await computeContentHash(stateContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const stateData: StateNodeData = {
          id: nodeId,
          name: node.name || `State ${index + 1}`,
          type: nodeType,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: stateContent
        };
        return {
          id: nodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: stateData
        };
      }

      case 'INPUT': {
        let parsedContent: InputContent;
        if (nodeContent) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsedContent = InputContent.fromJSON(nodeContent as any);
        } else {
          parsedContent = new InputContent([]);
        }
        const contentHash = await computeContentHash(parsedContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const inputData: InputNodeData = {
          id: nodeId,
          name: node.name || `Input ${index + 1}`,
          type: nodeType,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: parsedContent
        };
        return {
          id: nodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: inputData
        };
      }

      case 'PROMPT': {
        let parsedContent: PromptContent;
        if (nodeContent) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsedContent = PromptContent.fromJSON(nodeContent as any);
        } else {
          parsedContent = PromptContent.fromText('');
        }
        const contentHash = await computeContentHash(parsedContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const promptData: PromptNodeData = {
          id: nodeId,
          name: node.name || `Prompt ${index + 1}`,
          type: nodeType,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: parsedContent
        };
        return {
          id: nodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: promptData
        };
      }

      case 'GENERATED': {
        let parsedContent: GeneratedContent;
        if (nodeContent) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsedContent = GeneratedContent.fromJSON(nodeContent as any);
          // No need to remap - node IDs are preserved
        } else {
          parsedContent = new GeneratedContent([], { id: '', commit: '' }, [], []);
        }
        const contentHash = await computeContentHash(parsedContent.toJSON() as Parameters<typeof computeContentHash>[0]);
        const generatedData: GeneratedNodeData = {
          id: nodeId,
          name: node.name || `Generated ${index + 1}`,
          type: 'GENERATED' as const,
          commit,
          contentHash,
          snapshotRefs: [],
          parent,
          content: parsedContent
        };
        return {
          id: nodeId,
          type: 'GENERATED' as const,
          position: { x: posX, y: posY },
          data: generatedData
        };
      }

      default: {
        // For unknown types (like SAVE), skip them
        console.warn(`[Import] Skipping unsupported node type: ${nodeType}`);
        return null;
      }
    }
  }));

  // Filter out null entries (unsupported node types like SAVE)
  const validNodes = nodes.filter((n): n is NonNullable<typeof n> => n !== null);

  // Use original edge source/target IDs (no remapping needed)
  const edges: Edge[] = graphData.edges.map((edge: ArtifactEdge) => ({
    id: `e-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null
  }));

  return { nodes: validNodes, edges };
}

/**
 * Import an artifact into a new studio project.
 * Creates the project, converts the graph, and saves it.
 * 
 * @returns The new project ID
 */
export async function importArtifactToNewProject(
  graphData: ArtifactGraphData,
  artifactId: string
): Promise<string> {
  const newProjectId = crypto.randomUUID();
  
  // Create the project first so VFS can be initialized
  await ensureProject(newProjectId);
  
  const { nodes, edges } = await convertArtifactToStudioGraph(
    graphData, 
    artifactId, 
    newProjectId
  );
  
  // Initialize stores with the new project
  await nodeStore.init(newProjectId);
  await layoutStore.init(newProjectId);
  
  // Save node data and layouts
  for (const node of nodes) {
    nodeStore.set(node.id, node.data);
    layoutStore.add(node.id, node.position.x, node.position.y);
  }
  
  // Save edges
  await saveEdges(edges, newProjectId);
  
  // Flush stores to persist
  await nodeStore.flush();
  await layoutStore.flush();
  
  return newProjectId;
}

/**
 * Add an artifact's nodes to an existing studio project.
 * Offsets the new nodes to avoid overlap with existing nodes.
 */
export async function addArtifactToProject(
  graphData: ArtifactGraphData,
  artifactId: string,
  projectId: string,
  onProgress?: ImportProgressCallback
): Promise<void> {
  const { nodes: newNodes, edges: newEdges } = await convertArtifactToStudioGraph(
    graphData, 
    artifactId, 
    projectId,
    onProgress
  );
  
  // Phase: Saving to local storage
  onProgress?.({ phase: 'saving', current: 0, total: newNodes.length + 1 });
  
  // Ensure stores are initialized for this project
  if (nodeStore.currentProjectId !== projectId) {
    await nodeStore.init(projectId);
  }
  if (!layoutStore.isInitialized) {
    await layoutStore.init(projectId);
  }
  
  // Get existing layouts to calculate offset
  const existingLayouts = layoutStore.getAll();
  let maxX = 0;
  for (const layout of existingLayouts.values()) {
    if (layout.x > maxX) maxX = layout.x;
  }
  const offsetX = maxX + 400;
  
  // Get existing edges
  const existingEdges = await getEdges(projectId);
  
  // Save new nodes with offset
  for (let i = 0; i < newNodes.length; i++) {
    const node = newNodes[i];
    nodeStore.set(node.id, node.data);
    layoutStore.add(node.id, node.position.x + offsetX, node.position.y);
    if (i % 5 === 0 || i === newNodes.length - 1) {
      onProgress?.({ phase: 'saving', current: i + 1, total: newNodes.length + 1 });
    }
  }
  
  // Merge and save edges
  const mergedEdges = [...existingEdges, ...newEdges];
  await saveEdges(mergedEdges, projectId);
  onProgress?.({ phase: 'saving', current: newNodes.length + 1, total: newNodes.length + 1 });
  
  // Flush stores to persist
  await nodeStore.flush();
  await layoutStore.flush();
}
