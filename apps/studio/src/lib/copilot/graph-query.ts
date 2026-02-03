/**
 * Graph Query Interface
 * 
 * Provides read-only access to the flow graph for the Copilot Orchestrator.
 * Allows the Agent to understand the current state of the graph.
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types/flow';
import type { StudioNodeData } from '$lib/types';
import type { NodeRef } from '$lib/version';
import { nodeStore } from '$lib/persistence';
import { getNodeVfs } from '$lib/vfs';
import { HandleId, isTagHandle, getTagName, isRefTagHandle, getRefTagName } from '$lib/graph';
import { isVfsFolder } from '@pubwiki/vfs';
import type {
  NodeSummary,
  NodeDetail,
  EdgeInfo,
  NodeQuery,
  VersionInfo,
  VfsFileInfo,
  ConnectionType,
} from './types';

// ============================================================================
// Graph Query Interface
// ============================================================================

/**
 * Graph Query Interface - lets the Agent understand the flow graph
 */
export interface GraphQueryInterface {
  /** Get summary of all nodes */
  getNodesSummary(): NodeSummary[];
  
  /** Get detailed info about a specific node */
  getNodeDetail(nodeId: string): NodeDetail | null;
  
  /** Get node connections */
  getNodeConnections(nodeId: string): {
    incoming: EdgeInfo[];
    outgoing: EdgeInfo[];
  };
  
  /** Find nodes by query */
  findNodes(query: NodeQuery): NodeSummary[];
  
  /** Get node version history */
  getNodeHistory(nodeId: string): Promise<VersionInfo[]>;
  
  /** Get VFS contents */
  getVfsContents(vfsNodeId: string, path?: string): Promise<VfsFileInfo[]>;
  
  /** Describe the graph in natural language */
  describeGraph(): string;
  
  /** Explain a specific node */
  explainNode(nodeId: string): string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a GraphQueryInterface from current flow state
 */
export function createGraphQuery(
  nodes: Node<FlowNodeData>[],
  edges: Edge[]
): GraphQueryInterface {
  
  // Helper: Get node data from store
  const getNodeData = (nodeId: string): StudioNodeData | undefined => {
    return nodeStore.get(nodeId);
  };
  
  // Helper: Get content preview
  const getContentPreview = (data: StudioNodeData, maxLength = 100): string => {
    const text = data.content?.getText?.() ?? '';
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  };
  
  // Helper: Get full content
  const getFullContent = (data: StudioNodeData): string => {
    return data.content?.getText?.() ?? '';
  };
  
  // Helper: Determine connection type from edge
  const getConnectionType = (edge: Edge): ConnectionType => {
    const targetHandle = edge.targetHandle;
    if (!targetHandle) return 'default';
    
    if (targetHandle === HandleId.SYSTEM_TAG) return 'system';
    if (targetHandle === HandleId.VFS_INPUT || targetHandle === HandleId.VFS_GENERATOR_INPUT) return 'vfs';
    if (targetHandle === HandleId.SERVICE_INPUT) return 'service';
    if (isTagHandle(targetHandle)) return 'reftag';
    if (isRefTagHandle(targetHandle)) return 'reftag';
    
    return 'default';
  };
  
  // Helper: Convert edge to EdgeInfo
  const edgeToInfo = (edge: Edge): EdgeInfo => {
    const connectionType = getConnectionType(edge);
    return {
      id: edge.id,
      sourceNodeId: edge.source,
      targetNodeId: edge.target,
      sourceHandle: edge.sourceHandle ?? undefined,
      targetHandle: edge.targetHandle ?? undefined,
      connectionType,
    };
  };
  
  return {
    getNodesSummary(): NodeSummary[] {
      return nodes.map(node => {
        const data = getNodeData(node.id);
        if (!data) {
          return {
            id: node.id,
            type: node.data.type,
            name: '',
            preview: '',
            hasVersions: false,
          };
        }
        return {
          id: node.id,
          type: data.type,
          name: data.name || '',
          preview: getContentPreview(data),
          hasVersions: (data.snapshotRefs?.length ?? 0) > 0,
        };
      });
    },
    
    getNodeDetail(nodeId: string): NodeDetail | null {
      const data = getNodeData(nodeId);
      if (!data) return null;
      
      // Find if this node was generated from an input
      let createdFrom: string | undefined;
      if (data.type === 'GENERATED') {
        const genContent = data.content as { inputRef?: NodeRef };
        if (genContent.inputRef) {
          const inputData = getNodeData(genContent.inputRef.id);
          createdFrom = inputData ? `Generated from "${inputData.name || 'Input'}"` : undefined;
        }
      }
      
      return {
        id: nodeId,
        type: data.type,
        name: data.name || '',
        preview: getContentPreview(data),
        fullContent: getFullContent(data),
        commit: data.commit,
        parents: data.parents || [],
        hasVersions: (data.snapshotRefs?.length ?? 0) > 0,
        createdFrom,
      };
    },
    
    getNodeConnections(nodeId: string): { incoming: EdgeInfo[]; outgoing: EdgeInfo[] } {
      const incoming = edges
        .filter(e => e.target === nodeId)
        .map(edgeToInfo);
      
      const outgoing = edges
        .filter(e => e.source === nodeId)
        .map(edgeToInfo);
      
      return { incoming, outgoing };
    },
    
    findNodes(query: NodeQuery): NodeSummary[] {
      return nodes
        .map(node => {
          const data = getNodeData(node.id);
          if (!data) return null;
          
          // Filter by type
          if (query.type && data.type !== query.type) return null;
          
          // Filter by name pattern
          if (query.namePattern) {
            const pattern = new RegExp(query.namePattern, 'i');
            if (!pattern.test(data.name || '')) return null;
          }
          
          // Filter by content pattern
          if (query.contentPattern) {
            const pattern = new RegExp(query.contentPattern, 'i');
            const content = getFullContent(data);
            if (!pattern.test(content)) return null;
          }
          
          return {
            id: node.id,
            type: data.type,
            name: data.name || '',
            preview: getContentPreview(data),
            hasVersions: (data.snapshotRefs?.length ?? 0) > 0,
          };
        })
        .filter((n): n is NodeSummary => n !== null);
    },
    
    async getNodeHistory(nodeId: string): Promise<VersionInfo[]> {
      const data = getNodeData(nodeId);
      if (!data) return [];
      
      const history: VersionInfo[] = [];
      
      // Current version
      history.push({
        commit: data.commit,
        preview: getContentPreview(data, 50),
      });
      
      // Historical versions from snapshotRefs
      for (const ref of data.snapshotRefs || []) {
        const snapshot = await nodeStore.getVersion(nodeId, ref.commit);
        if (snapshot) {
          history.push({
            commit: ref.commit,
            preview: getContentPreview(snapshot, 50),
          });
        }
      }
      
      return history;
    },
    
    async getVfsContents(vfsNodeId: string, path = '/'): Promise<VfsFileInfo[]> {
      const data = getNodeData(vfsNodeId);
      if (!data || data.type !== 'VFS') return [];
      
      try {
        const vfsContent = data.content as { projectId: string };
        const vfs = await getNodeVfs(vfsContent.projectId, vfsNodeId);
        const items = await vfs.listFolder(path);
        
        return items.map(item => ({
          path: `${path}/${item.name}`.replace(/\/+/g, '/'),
          name: item.name,
          isDirectory: isVfsFolder(item),
        }));
      } catch (e) {
        console.error('[GraphQuery] Failed to list VFS:', e);
        return [];
      }
    },
    
    describeGraph(): string {
      const summaries = this.getNodesSummary();
      
      if (summaries.length === 0) {
        return 'The graph is empty.';
      }
      
      const lines: string[] = ['Current flow graph:'];
      
      // Group by type
      const byType = new Map<string, NodeSummary[]>();
      for (const node of summaries) {
        const list = byType.get(node.type) || [];
        list.push(node);
        byType.set(node.type, list);
      }
      
      for (const [type, nodeList] of byType) {
        lines.push(`\n${type} nodes (${nodeList.length}):`);
        for (const node of nodeList) {
          const name = node.name || `(unnamed ${node.id.slice(0, 8)})`;
          const preview = node.preview ? `: "${node.preview}"` : '';
          lines.push(`  - ${name}${preview}`);
        }
      }
      
      // Describe key connections
      lines.push('\nConnections:');
      for (const edge of edges) {
        const sourceData = getNodeData(edge.source);
        const targetData = getNodeData(edge.target);
        if (sourceData && targetData) {
          const sourceName = sourceData.name || sourceData.type;
          const targetName = targetData.name || targetData.type;
          const connType = getConnectionType(edge);
          lines.push(`  - ${sourceName} → ${targetName} (${connType})`);
        }
      }
      
      return lines.join('\n');
    },
    
    explainNode(nodeId: string): string {
      const detail = this.getNodeDetail(nodeId);
      if (!detail) return `Node ${nodeId} not found.`;
      
      const lines: string[] = [];
      lines.push(`Node: ${detail.name || '(unnamed)'}`);
      lines.push(`Type: ${detail.type}`);
      lines.push(`ID: ${detail.id}`);
      
      if (detail.createdFrom) {
        lines.push(`Origin: ${detail.createdFrom}`);
      }
      
      const { incoming, outgoing } = this.getNodeConnections(nodeId);
      
      if (incoming.length > 0) {
        lines.push('\nInputs:');
        for (const conn of incoming) {
          const sourceData = getNodeData(conn.sourceNodeId);
          const sourceName = sourceData?.name || conn.sourceNodeId.slice(0, 8);
          lines.push(`  - From "${sourceName}" (${conn.connectionType})`);
        }
      }
      
      if (outgoing.length > 0) {
        lines.push('\nOutputs:');
        for (const conn of outgoing) {
          const targetData = getNodeData(conn.targetNodeId);
          const targetName = targetData?.name || conn.targetNodeId.slice(0, 8);
          lines.push(`  - To "${targetName}" (${conn.connectionType})`);
        }
      }
      
      lines.push('\nContent:');
      lines.push(detail.fullContent || '(empty)');
      
      return lines.join('\n');
    },
  };
}
