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
 */
export async function convertArtifactToStudioGraph(
  graphData: ArtifactGraphData,
  artifactId: string,
  targetProjectId: string,
  contentFetcher: ContentFetcher
): Promise<{ nodes: Node<StudioNodeData>[]; edges: Edge[] }> {
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

  // Process VFS nodes: fetch details and files
  const vfsNodes = graphData.nodes.filter((n: ArtifactNodeSummary) => n.type === 'VFS' && !n.external);
  for (const vfsNode of vfsNodes) {
    // Fetch node detail to get file list
    const nodeDetail = await contentFetcher.fetchNodeDetail(artifactId, vfsNode.id);
    if (nodeDetail?.files && nodeDetail.files.length > 0) {
      // Get VFS instance for this node
      const vfs = await getNodeVfs(targetProjectId, vfsNode.id);
      
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
    // Calculate a default position (arranged in a grid)
    const posX = (index % 3) * 300 + 100;
    const posY = Math.floor(index / 3) * 200 + 100;

    const nodeType = node.type;
    const commit = await generateCommitHash(node.id);

    // Get content from map (may be JSON or plain text depending on backend)
    const rawContent = contentMap.get(node.id) ?? '';

    // Handle each node type
    switch (nodeType) {
      case 'VFS': {
        const vfsData: VFSNodeData = {
          id: node.id,
          name: node.name || `Files ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: new VFSContent(targetProjectId),
          expandedFolders: [],
          selectedFilePath: undefined,
          isExpandedViewOpen: false,
          external: true
        };
        return {
          id: node.id,
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
          id: node.id,
          name: node.name || `Sandbox ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          isRunning: false,
          error: null
        };
        return {
          id: node.id,
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
          id: node.id,
          name: node.name || `Loader ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          error: null,
          registeredServices: []
        };
        return {
          id: node.id,
          type: nodeType,
          position: { x: posX, y: posY },
          data: loaderData
        };
      }

      case 'STATE': {
        const stateData: StateNodeData = {
          id: node.id,
          name: node.name || `State ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: new StateContent(),
          external: true,
          isReady: false,
          error: null,
          tripleCount: 0
        };
        return {
          id: node.id,
          type: nodeType,
          position: { x: posX, y: posY },
          data: stateData
        };
      }

      case 'INPUT': {
        let parsedContent: InputContent;
        try {
          const json = JSON.parse(rawContent);
          parsedContent = InputContent.fromJSON(json);
        } catch {
          parsedContent = new InputContent(rawContent, []);
        }
        const inputData: InputNodeData = {
          id: node.id,
          name: node.name || `Input ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true
        };
        return {
          id: node.id,
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
          parsedContent = new PromptContent(rawContent);
        }
        const promptData: PromptNodeData = {
          id: node.id,
          name: node.name || `Prompt ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          isEditing: false
        };
        return {
          id: node.id,
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
        } catch {
          parsedContent = new GeneratedContent([], { id: '', commit: '' }, [], []);
        }
        const generatedData: GeneratedNodeData = {
          id: node.id,
          name: node.name || `Generated ${index + 1}`,
          type: nodeType,
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          isStreaming: false
        };
        return {
          id: node.id,
          type: nodeType,
          position: { x: posX, y: posY },
          data: generatedData
        };
      }
    }
  }));

  const edges: Edge[] = graphData.edges.map((edge: ArtifactEdge) => ({
    id: `e-${edge.source}-${edge.target}`,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null
  }));

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
