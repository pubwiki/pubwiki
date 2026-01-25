/**
 * Studio Import Utilities
 * 
 * Functions for importing artifacts into studio projects.
 * 
 * Note: After content-type refactoring, imported content should be parsed as JSON
 * when the backend sends JSON content (node.json files).
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { ArtifactGraphData, ArtifactNodeDetail, ArtifactNodeSummary, ArtifactEdge, NodeFileInfo } from '$lib/types';
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
 */
export interface ContentFetcher {
  fetchNodeContent(artifactId: string, nodeId: string): Promise<string | null>;
  fetchNodeDetail(artifactId: string, nodeId: string): Promise<ArtifactNodeDetail | null>;
}

/**
 * ID mapping from old (artifact) node IDs to new (studio) node IDs
 */
type IdMap = Map<string, string>;

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
// Internal Helpers
// ============================================================================

/**
 * Fetch a single VFS file content from the API
 */
async function fetchVfsFileContent(
  artifactId: string, 
  nodeId: string, 
  filePath: string
): Promise<Uint8Array | null> {
  try {
    const response = await fetch(
      `${API_BASE_URL}/artifacts/${artifactId}/nodes/${nodeId}/files/${encodeURIComponent(filePath)}`
    );
    if (response.ok) {
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Core Import Functions
// ============================================================================

/**
 * Convert artifact graph data to studio nodes and edges format.
 * Fetches content for each node from the API.
 * For VFS nodes, also fetches all files and writes them to the VFS storage.
 * 
 * All nodes are assigned new UUIDs to avoid ID conflicts with existing nodes.
 * References within node content (e.g., GeneratedContent refs) are remapped accordingly.
 */
export async function convertArtifactToStudioGraph(
  graphData: ArtifactGraphData,
  artifactId: string,
  targetProjectId: string,
  contentFetcher: ContentFetcher
): Promise<{ nodes: Node<StudioNodeData>[]; edges: Edge[] }> {
  // Create ID mapping for all nodes (old ID -> new UUID)
  const idMap = createIdMapping(graphData.nodes);

  // Fetch content for all non-VFS nodes in parallel
  const contentPromises = graphData.nodes.map(async (node: ArtifactNodeSummary) => {
    // Skip VFS nodes and external nodes
    if (node.type === 'VFS' || node.external) {
      return { nodeId: node.id, content: '' };
    }
    const content = await contentFetcher.fetchNodeContent(artifactId, node.id);
    return { nodeId: node.id, content: content ?? '' };
  });
  
  const contentResults = await Promise.all(contentPromises);
  const contentMap = new Map<string, string>(contentResults.map((r: { nodeId: string; content: string }) => [r.nodeId, r.content]));

  // Process VFS nodes: fetch details and files (use NEW node IDs for VFS storage)
  const vfsNodes = graphData.nodes.filter((n: ArtifactNodeSummary) => n.type === 'VFS' && !n.external);
  for (const vfsNode of vfsNodes) {
    // Fetch node detail to get file list
    const nodeDetail = await contentFetcher.fetchNodeDetail(artifactId, vfsNode.id);
    if (nodeDetail?.files && nodeDetail.files.length > 0) {
      // Get VFS instance for this node using the NEW ID
      const newNodeId = idMap.get(vfsNode.id)!;
      const vfs = await getNodeVfs(targetProjectId, newNodeId);
      
      // Fetch and write all files in parallel
      const filePromises = nodeDetail.files.map(async (fileInfo: NodeFileInfo) => {
        const content = await fetchVfsFileContent(artifactId, vfsNode.id, fileInfo.filepath);
        if (content) {
          await vfs.createFile(fileInfo.filepath, content.buffer as ArrayBuffer);
        }
      });
      await Promise.all(filePromises);
      
      // Commit the changes
      await vfs.commit('Imported from artifact');
    }
  }

  const nodes: Node<StudioNodeData>[] = await Promise.all(graphData.nodes.map(async (node: ArtifactNodeSummary, index: number) => {
    // Get the new ID for this node
    const newNodeId = idMap.get(node.id)!;
    
    // Use saved position if available, otherwise calculate a default position (arranged in a grid)
    const posX = node.position?.x ?? ((index % 3) * 300 + 100);
    const posY = node.position?.y ?? (Math.floor(index / 3) * 200 + 100);

    const nodeType = node.type;
    const commit = await generateCommitHash(newNodeId);

    // Get content from map (may be JSON or plain text depending on backend)
    const rawContent = contentMap.get(node.id) ?? '';

    // Handle each node type
    switch (nodeType) {
      case 'VFS': {
        const vfsData: VFSNodeData = {
          id: newNodeId,
          name: node.name || `Files ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: new VFSContent(targetProjectId),
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
        try {
          const json = JSON.parse(rawContent);
          parsedContent = SandboxContent.fromJSON(json);
        } catch {
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
        try {
          const json = JSON.parse(rawContent);
          parsedContent = LoaderContent.fromJSON(json);
        } catch {
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
        const stateData: StateNodeData = {
          id: newNodeId,
          name: node.name || `State ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: new StateContent(),
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
        const json = JSON.parse(rawContent);
        const parsedContent = InputContent.fromJSON(json);
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
        try {
          const json = JSON.parse(rawContent);
          parsedContent = PromptContent.fromJSON(json);
        } catch {
          parsedContent = PromptContent.fromText(rawContent);
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
        try {
          const json = JSON.parse(rawContent);
          parsedContent = GeneratedContent.fromJSON(json);
          // Remap node ID references in GeneratedContent
          parsedContent = remapGeneratedContent(parsedContent, idMap);
        } catch {
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
