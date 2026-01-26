/**
 * Studio Import Utilities
 * 
 * Functions for importing artifacts into studio projects.
 * 
 * After artifact storage refactoring:
 * - Node content is now included directly in the graph response
 * - VFS nodes need to download and extract tar.gz archives
 * - No separate /content API calls needed
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { ArtifactGraphData, ArtifactNodeDetail, ArtifactNodeSummary, ArtifactEdge } from '$lib/types';
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
import { generateCommitHash } from '../version';
import { getNodeVfs } from '../vfs';
import { ensureProject, saveEdges, getEdges, nodeStore, layoutStore } from '../persistence';
import { API_BASE_URL } from '$lib/config';

// ============================================================================
// Types
// ============================================================================

/**
 * Content fetcher interface for dependency injection
 * After refactoring: only used for VFS archive downloads
 */
export interface ContentFetcher {
  /** @deprecated Content is now in graph response */
  fetchNodeContent(artifactId: string, nodeId: string): Promise<string | null>;
  fetchNodeDetail(artifactId: string, nodeId: string): Promise<ArtifactNodeDetail | null>;
  /** Fetch VFS tar.gz archive for a node */
  fetchVfsArchive?(artifactId: string, nodeId: string): Promise<ArrayBuffer | null>;
}

/**
 * ID mapping from old (artifact) node IDs to new (studio) node IDs
 */
type IdMap = Map<string, string>;

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
 * Fetch and extract VFS archive from API
 */
async function fetchAndExtractVfsArchive(
  artifactId: string, 
  nodeId: string
): Promise<{ path: string; content: Uint8Array }[]> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/artifacts/${artifactId}/nodes/${nodeId}/archive`
    );
    if (!response.ok) {
      console.warn(`Failed to fetch VFS archive for node ${nodeId}: ${response.status}`);
      return [];
    }
    
    const gzippedData = await response.arrayBuffer();
    const tarData = await gzipDecompress(gzippedData);
    return parseTar(tarData);
  } catch (error) {
    console.error(`Error fetching VFS archive for node ${nodeId}:`, error);
    return [];
  }
}

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Generate new IDs for all nodes and create a mapping
 */
function createIdMapping(nodes: ArtifactNodeSummary[]): IdMap {
  const idMap = new Map<string, string>();
  for (const node of nodes) {
    idMap.set(node.id, crypto.randomUUID());
  }
  return idMap;
}

/**
 * Remap node ID references in GeneratedContent
 */
function remapGeneratedContent(content: GeneratedContent, idMap: IdMap): GeneratedContent {
  const remapNodeRef = (ref: { id: string; commit: string }) => ({
    id: idMap.get(ref.id) ?? ref.id,
    commit: ref.commit
  });

  return new GeneratedContent(
    structuredClone(content.blocks),
    remapNodeRef(content.inputRef),
    content.promptRefs.map(remapNodeRef),
    content.indirectPromptRefs.map(remapNodeRef),
    content.inputVfsRef ? {
      nodeId: idMap.get(content.inputVfsRef.nodeId) ?? content.inputVfsRef.nodeId,
      commit: content.inputVfsRef.commit
    } : null,
    content.outputVfsId ? (idMap.get(content.outputVfsId) ?? content.outputVfsId) : null
  );
}

// ============================================================================
// Core Import Functions
// ============================================================================

/**
 * Convert artifact graph data to studio nodes and edges format.
 * 
 * After artifact storage refactoring:
 * - Node content is directly available in graphData.nodes[].content
 * - VFS nodes: download tar.gz archive and extract to VFS storage
 * 
 * All nodes are assigned new UUIDs to avoid ID conflicts with existing nodes.
 * References within node content (e.g., GeneratedContent refs) are remapped accordingly.
 */
export async function convertArtifactToStudioGraph(
  graphData: ArtifactGraphData,
  artifactId: string,
  targetProjectId: string,
  _contentFetcher?: ContentFetcher  // @deprecated - kept for API compatibility
): Promise<{ nodes: Node<StudioNodeData>[]; edges: Edge[] }> {
  // Cast nodes to extended type that includes content
  const nodesWithContent = graphData.nodes as NodeSummaryWithContent[];
  
  // Create ID mapping for all nodes (old ID -> new UUID)
  const idMap = createIdMapping(graphData.nodes);

  // Process VFS nodes: download tar.gz and extract files (use NEW node IDs for VFS storage)
  const vfsNodes = nodesWithContent.filter((n) => n.type === 'VFS' && !n.external);
  for (const vfsNode of vfsNodes) {
    // Download and extract tar.gz archive
    const files = await fetchAndExtractVfsArchive(artifactId, vfsNode.id);
    
    if (files.length > 0) {
      // Get VFS instance for this node using the NEW ID
      const newNodeId = idMap.get(vfsNode.id)!;
      const vfs = await getNodeVfs(targetProjectId, newNodeId);
      
      // Write all files to VFS
      for (const file of files) {
        await vfs.createFile(file.path, new Uint8Array(file.content).buffer as ArrayBuffer);
      }
      
      // Commit the changes
      await vfs.commit('Imported from artifact');
    }
  }

  const nodes: Node<StudioNodeData>[] = await Promise.all(nodesWithContent.map(async (node: NodeSummaryWithContent, index: number) => {
    // Get the new ID for this node
    const newNodeId = idMap.get(node.id)!;
    
    // Use saved position if available, otherwise calculate a default position (arranged in a grid)
    const posX = node.position?.x ?? ((index % 3) * 300 + 100);
    const posY = node.position?.y ?? (Math.floor(index / 3) * 200 + 100);

    const nodeType = node.type;
    const commit = await generateCommitHash(newNodeId);

    // Get content directly from node (new architecture)
    // Content is already parsed as JSON in the graph response
    const nodeContent = node.content;

    // Handle each node type
    switch (nodeType) {
      case 'VFS': {
        // VFS content comes from graph, files were already extracted above
        // VFSContent needs projectId, which we set to targetProjectId
        const vfsContent = new VFSContent(targetProjectId);
        const vfsData: VFSNodeData = {
          id: newNodeId,
          name: node.name || `Files ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: vfsContent,
          expandedFolders: [],
          selectedFilePath: undefined,
          isExpandedViewOpen: false,
          external: true,
          originalRef: { nodeId: node.id, commit }
        };
        return {
          id: newNodeId,
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
        const sandboxData: SandboxNodeData = {
          id: newNodeId,
          name: node.name || `Sandbox ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          originalRef: { nodeId: node.id, commit },
          isRunning: false,
          error: null
        };
        return {
          id: newNodeId,
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
        const loaderData: LoaderNodeData = {
          id: newNodeId,
          name: node.name || `Loader ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          originalRef: { nodeId: node.id, commit },
          error: null,
          registeredServices: []
        };
        return {
          id: newNodeId,
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
        const stateData: StateNodeData = {
          id: newNodeId,
          name: node.name || `State ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: stateContent,
          external: true,
          originalRef: { nodeId: node.id, commit },
          isReady: false,
          error: null,
          tripleCount: 0
        };
        return {
          id: newNodeId,
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
        const inputData: InputNodeData = {
          id: newNodeId,
          name: node.name || `Input ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          originalRef: { nodeId: node.id, commit }
        };
        return {
          id: newNodeId,
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
        const promptData: PromptNodeData = {
          id: newNodeId,
          name: node.name || `Prompt ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          originalRef: { nodeId: node.id, commit },
          isEditing: false
        };
        return {
          id: newNodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: promptData
        };
      }

      case 'GENERATED':
      default: {
        let parsedContent: GeneratedContent;
        if (nodeContent) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          parsedContent = GeneratedContent.fromJSON(nodeContent as any);
          // Remap node ID references in GeneratedContent
          parsedContent = remapGeneratedContent(parsedContent, idMap);
        } else {
          parsedContent = new GeneratedContent([], { id: '', commit: '' }, [], []);
        }
        const generatedData: GeneratedNodeData = {
          id: newNodeId,
          name: node.name || `Generated ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          originalRef: { nodeId: node.id, commit },
          isStreaming: false
        };
        return {
          id: newNodeId,
          type: nodeType,
          position: { x: posX, y: posY },
          data: generatedData
        };
      }
    }
  }));

  // Remap edge source/target to new node IDs
  const edges: Edge[] = graphData.edges.map((edge: ArtifactEdge) => {
    const newSource = idMap.get(edge.source) ?? edge.source;
    const newTarget = idMap.get(edge.target) ?? edge.target;
    return {
      id: `e-${newSource}-${newTarget}`,
      source: newSource,
      target: newTarget,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null
    };
  });

  return { nodes, edges };
}

/**
 * Import an artifact into a new studio project.
 * Creates the project, converts the graph, and saves it.
 * 
 * @returns The new project ID
 */
export async function importArtifactToNewProject(
  graphData: ArtifactGraphData,
  artifactId: string,
  contentFetcher: ContentFetcher
): Promise<string> {
  const newProjectId = crypto.randomUUID();
  
  // Create the project first so VFS can be initialized
  await ensureProject(newProjectId);
  
  const { nodes, edges } = await convertArtifactToStudioGraph(
    graphData, 
    artifactId, 
    newProjectId, 
    contentFetcher
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
  contentFetcher: ContentFetcher
): Promise<void> {
  const { nodes: newNodes, edges: newEdges } = await convertArtifactToStudioGraph(
    graphData, 
    artifactId, 
    projectId, 
    contentFetcher
  );
  
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
  for (const node of newNodes) {
    nodeStore.set(node.id, node.data);
    layoutStore.add(node.id, node.position.x + offsetX, node.position.y);
  }
  
  // Merge and save edges
  const mergedEdges = [...existingEdges, ...newEdges];
  await saveEdges(mergedEdges, projectId);
  
  // Flush stores to persist
  await nodeStore.flush();
  await layoutStore.flush();
}
