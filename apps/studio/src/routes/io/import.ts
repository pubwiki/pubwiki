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
import { ensureProject, saveGraph, loadGraph } from '../persistence';
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

  // Node type definition for type checking
  type StudioNodeType = 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS' | 'SANDBOX' | 'LOADER' | 'STATE';

  const nodes: Node<StudioNodeData>[] = await Promise.all(graphData.nodes.map(async (node: ArtifactNodeSummary, index: number) => {
    // Calculate a default position (arranged in a grid)
    const posX = (index % 3) * 300 + 100;
    const posY = Math.floor(index / 3) * 200 + 100;

    const nodeType = node.type as StudioNodeType;
    const commit = await generateCommitHash(node.id);

    // Get content from map (may be JSON or plain text depending on backend)
    const rawContent = contentMap.get(node.id) ?? '';

    // Handle each node type
    switch (nodeType) {
      case 'VFS': {
        const vfsData: VFSNodeData = {
          id: node.id,
          name: node.name || `Files ${index + 1}`,
          type: 'VFS',
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
          type: 'vfs',
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
          type: 'SANDBOX',
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
          type: 'sandbox',
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
          type: 'LOADER',
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
          type: 'loader',
          position: { x: posX, y: posY },
          data: loaderData
        };
      }

      case 'STATE': {
        const stateData: StateNodeData = {
          id: node.id,
          name: node.name || `State ${index + 1}`,
          type: 'STATE',
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
          type: 'state',
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
          type: 'INPUT',
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true
        };
        return {
          id: node.id,
          type: 'input',
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
          type: 'PROMPT',
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          isEditing: false
        };
        return {
          id: node.id,
          type: 'prompt',
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
          type: 'GENERATED',
          commit,
          snapshotRefs: [],
          parents: [],
          content: parsedContent,
          external: true,
          isStreaming: false
        };
        return {
          id: node.id,
          type: 'generated',
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
  
  // Save the graph
  await saveGraph(nodes, edges, newProjectId);
  
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
  
  // Load existing graph
  const existing = await loadGraph<StudioNodeData>(projectId);
  
  // Calculate offset for new nodes to avoid overlap
  const maxX = existing.nodes.reduce((max, n) => Math.max(max, n.position.x), 0);
  const offsetX = maxX + 400;
  
  // Offset new nodes
  const offsetNodes = newNodes.map(n => ({
    ...n,
    position: { x: n.position.x + offsetX, y: n.position.y }
  }));
  
  // Merge and save
  const mergedNodes = [...existing.nodes, ...offsetNodes];
  const mergedEdges = [...existing.edges, ...newEdges];
  
  await saveGraph(mergedNodes, mergedEdges, projectId);
}
