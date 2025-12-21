/**
 * Studio Import Utilities
 * 
 * Functions for importing artifacts into studio projects.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { ArtifactGraphData, ArtifactNodeDetail } from '$lib/stores/artifacts.svelte';
import type { StudioNodeData, VFSNodeData } from './types';
import { generateCommitHash } from './types';
import { getNodeVfs } from '../stores/vfs';
import { ensureProject, saveGraph, loadGraph } from '../stores/db';

const API_BASE_URL = 'http://localhost:8787/api';

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
  const contentPromises = graphData.nodes.map(async (node) => {
    // Skip VFS nodes and external nodes
    if (node.type === 'VFS' || node.external) {
      return { nodeId: node.id, content: '' };
    }
    const content = await contentFetcher.fetchNodeContent(artifactId, node.id);
    return { nodeId: node.id, content: content ?? '' };
  });
  
  const contentResults = await Promise.all(contentPromises);
  const contentMap = new Map(contentResults.map(r => [r.nodeId, r.content]));

  // Process VFS nodes: fetch details and files
  const vfsNodes = graphData.nodes.filter(n => n.type === 'VFS' && !n.external);
  for (const vfsNode of vfsNodes) {
    // Fetch node detail to get file list
    const nodeDetail = await contentFetcher.fetchNodeDetail(artifactId, vfsNode.id);
    if (nodeDetail?.files && nodeDetail.files.length > 0) {
      // Get VFS instance for this node
      const vfs = await getNodeVfs(targetProjectId, vfsNode.id);
      
      // Fetch and write all files in parallel
      const filePromises = nodeDetail.files.map(async (fileInfo) => {
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

  const nodes: Node<StudioNodeData>[] = await Promise.all(graphData.nodes.map(async (node, index) => {
    // Calculate a default position (arranged in a grid)
    const posX = (index % 3) * 300 + 100;
    const posY = Math.floor(index / 3) * 200 + 100;

    // Map artifact node type to studio node type
    const nodeType = node.type as 'PROMPT' | 'INPUT' | 'GENERATED' | 'VFS';

    if (nodeType === 'VFS') {
      // Create VFS node data with projectId
      const commit = await generateCommitHash('');
      const vfsData: VFSNodeData = {
        id: node.id,
        name: node.name || `Files ${index + 1}`,
        type: 'VFS',
        commit,
        snapshotRefs: [],
        parents: [],
        content: '',
        projectId: targetProjectId,
        expandedFolders: [],
        selectedFilePath: undefined,
        isExpandedViewOpen: false,
        external: true  // Always mark imported nodes as external
      };
      return {
        id: node.id,
        type: 'vfs',
        position: { x: posX, y: posY },
        data: vfsData as unknown as StudioNodeData
      };
    }

    // Create base node data based on type
    const baseData = {
      id: node.id,
      name: node.name || `Node ${index + 1}`,
      commit: graphData.version.commitHash,
      snapshotRefs: [],
      parents: [],
      content: contentMap.get(node.id) ?? '',
      external: true,  // Always mark imported nodes as external
      type: nodeType
    };

    return {
      id: node.id,
      type: nodeType.toLowerCase(),
      position: { x: posX, y: posY },
      data: baseData as unknown as StudioNodeData
    };
  }));

  const edges: Edge[] = graphData.edges.map((edge) => ({
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
