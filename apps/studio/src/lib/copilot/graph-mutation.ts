/**
 * Graph Mutation Interface
 * 
 * Provides write operations for the flow graph.
 * Used by the Copilot Orchestrator to modify the graph.
 * 
 * Note: This layer only handles structural changes (create nodes, connect).
 * Actual content generation is delegated to Sub-Agents (Input Nodes).
 */

import { Position, type Node, type Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types/flow';
import type { StudioNodeData, InputNodeData } from '$lib/types';
import {
  createInputNodeData,
  createPromptNodeData,
  createVFSNodeData,
  createSandboxNodeData,
  createLoaderNodeData,
  createStateNodeData,
} from '$lib/types';
import { nodeStore, layoutStore } from '$lib/persistence';
import { HandleId } from '$lib/graph';
import { positionNewNodesFromSources, DEFAULT_NODE_WIDTH, HORIZONTAL_GAP, VERTICAL_GAP } from '$lib/graph';
import { generate as triggerInputGeneration, type GenerationCallbacks } from '$components/nodes/input/controller.svelte';
import { onStreamingChange, notifyStreamingChange, isNodeStreaming } from '$components/nodes/generated/controller.svelte';
import type {
  CreateNodeParams,
  ConnectParams,
  NodeContentUpdate,
  GenerationResult,
  GeneratedContentResult,
  ConnectionType,
} from './types';

// ============================================================================
// Graph Mutation Interface
// ============================================================================

/**
 * Graph Mutation Interface - lets the Agent modify the flow graph
 */
export interface GraphMutationInterface {
  /** Create a new node */
  createNode(params: CreateNodeParams): Promise<string>;
  
  /** Update node content */
  updateNodeContent(nodeId: string, content: NodeContentUpdate): Promise<void>;
  
  /** Connect two nodes */
  connectNodes(params: ConnectParams): Promise<string>;
  
  /** Disconnect nodes */
  disconnectNodes(edgeId: string): Promise<void>;
  
  /** Delete a node */
  deleteNode(nodeId: string): Promise<void>;
  
  /** Trigger generation from an Input node */
  triggerGeneration(inputNodeId: string): Promise<GenerationResult>;
  
  /** Wait for generation to complete */
  awaitGeneration(generatedNodeId: string): Promise<GeneratedContentResult>;
}

// ============================================================================
// Callbacks for Flow Updates
// ============================================================================

/**
 * Callbacks to update the flow state
 */
export interface FlowCallbacks {
  getNodes: () => Node<FlowNodeData>[];
  getEdges: () => Edge[];
  setNodes: (nodes: Node<FlowNodeData>[]) => void;
  updateNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
}

/**
 * Generation settings
 */
export interface GenerationSettings {
  api: {
    apiKey: string;
    selectedModel: string;
  };
  effectiveBaseUrl: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a GraphMutationInterface from flow callbacks
 */
export function createGraphMutation(
  callbacks: FlowCallbacks,
  settings: GenerationSettings,
  projectId: string
): GraphMutationInterface {
  
  // Helper: Calculate position for new node
  const calculatePosition = (params: CreateNodeParams): { x: number; y: number } => {
    if (params.position) {
      return params.position;
    }
    
    if (params.relativeTo) {
      const nodes = callbacks.getNodes();
      const refNode = nodes.find(n => n.id === params.relativeTo!.nodeId);
      if (refNode) {
        const { direction } = params.relativeTo;
        const offset = DEFAULT_NODE_WIDTH + HORIZONTAL_GAP;
        
        switch (direction) {
          case 'right':
            return { x: refNode.position.x + offset, y: refNode.position.y };
          case 'left':
            return { x: refNode.position.x - offset, y: refNode.position.y };
          case 'bottom':
            return { x: refNode.position.x, y: refNode.position.y + VERTICAL_GAP + 150 };
          case 'top':
            return { x: refNode.position.x, y: refNode.position.y - VERTICAL_GAP - 150 };
        }
      }
    }
    
    // Default: find empty space
    const nodes = callbacks.getNodes();
    if (nodes.length === 0) {
      return { x: 100, y: 100 };
    }
    
    // Place to the right of rightmost node
    const maxX = Math.max(...nodes.map(n => n.position.x));
    const avgY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length;
    return { x: maxX + DEFAULT_NODE_WIDTH + HORIZONTAL_GAP, y: avgY };
  };
  
  // Helper: Get handle ID for connection type
  const getTargetHandle = (connType: ConnectionType, tagName?: string): string | undefined => {
    switch (connType) {
      case 'system':
        return HandleId.SYSTEM_TAG;
      case 'vfs':
        return HandleId.VFS_INPUT;
      case 'service':
        return HandleId.SERVICE_INPUT;
      case 'reftag':
        // For reftag, we need the tag name
        return tagName ? `tag-${tagName}` : undefined;
      default:
        return undefined;
    }
  };
  
  // Helper: Get source handle for connection type
  // VFS nodes use HandleId.DEFAULT for their output
  const getSourceHandle = (connType: ConnectionType): string | undefined => {
    switch (connType) {
      case 'vfs':
        return HandleId.DEFAULT;  // VFS nodes have 'default' output handle
      case 'service':
        return HandleId.LOADER_OUTPUT;
      default:
        return undefined;
    }
  };
  
  // Helper: Check if node name is unique
  const isNameUnique = (name: string): boolean => {
    const nodes = callbacks.getNodes();
    return !nodes.some(n => {
      const data = nodeStore.get(n.id);
      return data && 'name' in data && data.name === name;
    });
  };
  
  // Helper: Generate unique name if needed
  const ensureUniqueName = (baseName: string): string => {
    if (isNameUnique(baseName)) {
      return baseName;
    }
    
    // Append number to make unique
    let counter = 2;
    while (!isNameUnique(`${baseName} (${counter})`)) {
      counter++;
    }
    return `${baseName} (${counter})`;
  };
  
  return {
    async createNode(params: CreateNodeParams): Promise<string> {
      // Validate name is provided
      if (!params.name || params.name.trim() === '') {
        throw new Error('Node name is required and cannot be empty');
      }
      
      // Ensure name is unique
      const uniqueName = ensureUniqueName(params.name.trim());
      if (uniqueName !== params.name.trim()) {
        console.warn(`Node name "${params.name}" already exists, using "${uniqueName}" instead`);
      }
      
      const position = calculatePosition(params);
      let nodeData: StudioNodeData;
      
      // Create node data based on type (using uniqueName)
      // parent is null for newly created nodes (no version lineage)
      const nodeName = uniqueName;
      switch (params.type) {
        case 'INPUT':
          nodeData = await createInputNodeData(params.content || '', null, nodeName);
          break;
        case 'PROMPT':
          nodeData = await createPromptNodeData(params.content || '', null, nodeName);
          break;
        case 'VFS':
          nodeData = await createVFSNodeData(projectId, nodeName);
          break;
        case 'SANDBOX':
          nodeData = await createSandboxNodeData(nodeName);
          break;
        case 'LOADER':
          nodeData = await createLoaderNodeData(nodeName);
          break;
        case 'STATE':
          nodeData = await createStateNodeData(nodeName);
          break;
        default:
          throw new Error(`Unsupported node type: ${params.type}`);
      }
      
      // Store node data
      nodeStore.create(nodeData);
      
      // Store layout
      layoutStore.add(nodeData.id, position.x, position.y);
      
      // Create flow node
      const flowNode: Node<FlowNodeData> = {
        id: nodeData.id,
        type: nodeData.type,
        position,
        data: { id: nodeData.id, type: nodeData.type },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
      
      // Add to flow
      callbacks.updateNodes(nodes => [...nodes, flowNode]);
      
      console.log('[GraphMutation] Created node:', nodeData.id, nodeData.type);
      return nodeData.id;
    },
    
    async updateNodeContent(nodeId: string, content: NodeContentUpdate): Promise<void> {
      const data = nodeStore.get(nodeId);
      if (!data) {
        throw new Error(`Node not found: ${nodeId}`);
      }
      
      // Update based on node type
      if (data.type === 'PROMPT' && content.text !== undefined) {
        const { PromptContent } = await import('$lib/types');
        const newContent = PromptContent.fromText(content.text!);
        nodeStore.set(nodeId, { ...data, content: newContent });
      } else if (data.type === 'INPUT' && content.text !== undefined) {
        const { InputContent } = await import('$lib/types');
        const inputData = data as InputNodeData;
        const newContent = new InputContent([{ type: 'TextBlock', value: content.text! }]);
        // Preserve generationConfig from the existing content
        if (inputData.content?.generationConfig) {
          newContent.generationConfig = inputData.content.generationConfig;
        }
        nodeStore.set(nodeId, { ...inputData, content: newContent });
      }
      
      console.log('[GraphMutation] Updated node content:', nodeId);
    },
    
    async connectNodes(params: ConnectParams): Promise<string> {
      const nodes = callbacks.getNodes();
      
      // Validate source node exists
      const sourceNode = nodes.find(n => n.id === params.sourceNodeId);
      if (!sourceNode) {
        throw new Error(`Source node not found: ${params.sourceNodeId}`);
      }
      
      // Validate target node exists
      const targetNode = nodes.find(n => n.id === params.targetNodeId);
      if (!targetNode) {
        throw new Error(`Target node not found: ${params.targetNodeId}`);
      }
      
      // Validate not connecting to self
      if (params.sourceNodeId === params.targetNodeId) {
        throw new Error('Cannot connect a node to itself');
      }
      
      // Check if connection already exists
      const edges = callbacks.getEdges();
      const targetHandle = getTargetHandle(params.connectionType, params.tagName);
      const sourceHandle = getSourceHandle(params.connectionType);
      const existingEdge = edges.find(e => 
        e.source === params.sourceNodeId && 
        e.target === params.targetNodeId &&
        e.sourceHandle === sourceHandle &&
        e.targetHandle === targetHandle
      );
      if (existingEdge) {
        console.log('[GraphMutation] Connection already exists:', existingEdge.id);
        return existingEdge.id;
      }
      
      const edgeId = `e-${params.sourceNodeId}-${params.targetNodeId}-${Date.now()}`;
      
      const edge: Edge = {
        id: edgeId,
        source: params.sourceNodeId,
        target: params.targetNodeId,
        sourceHandle,
        targetHandle,
      };
      
      callbacks.updateEdges(edges => [...edges, edge]);
      
      console.log('[GraphMutation] Connected nodes:', params.sourceNodeId, '->', params.targetNodeId);
      return edgeId;
    },
    
    async disconnectNodes(edgeId: string): Promise<void> {
      callbacks.updateEdges(edges => edges.filter(e => e.id !== edgeId));
      console.log('[GraphMutation] Disconnected edge:', edgeId);
    },
    
    async deleteNode(nodeId: string): Promise<void> {
      // Remove from flow
      callbacks.updateNodes(nodes => nodes.filter(n => n.id !== nodeId));
      
      // Remove connected edges
      callbacks.updateEdges(edges => 
        edges.filter(e => e.source !== nodeId && e.target !== nodeId)
      );
      
      // Remove from stores
      nodeStore.delete(nodeId);
      layoutStore.delete(nodeId);
      
      console.log('[GraphMutation] Deleted node:', nodeId);
    },
    
    async triggerGeneration(inputNodeId: string): Promise<GenerationResult> {
      const nodes = callbacks.getNodes();
      const edges = callbacks.getEdges();
      
      // Create generation callbacks
      const genCallbacks = {
        updateNodeData: (id: string, updater: (d: StudioNodeData) => StudioNodeData) => {
          nodeStore.update(id, updater);
        },
        updateNodes: callbacks.updateNodes,
        updateEdges: callbacks.updateEdges,
      };
      
      try {
        const result = await triggerInputGeneration(
          inputNodeId,
          nodes,
          edges,
          settings,
          genCallbacks,
          projectId
        );
        
        if (result) {
          return {
            generatedNodeId: result.id,
            inputNodeId,
            success: true,
          };
        } else {
          return {
            generatedNodeId: '',
            inputNodeId,
            success: false,
          };
        }
      } catch (e) {
        console.error('[GraphMutation] Generation failed:', e);
        return {
          generatedNodeId: '',
          inputNodeId,
          success: false,
        };
      }
    },
    
    async awaitGeneration(generatedNodeId: string): Promise<GeneratedContentResult> {
      return new Promise((resolve) => {
        // Check if already done
        const checkDone = () => {
          const data = nodeStore.get(generatedNodeId);
          if (data && data.type === 'GENERATED') {
            const content = data.content as { blocks?: unknown[]; getText?: () => string };
            
            // Extract file operations from blocks
            const filesCreated: string[] = [];
            const filesModified: string[] = [];
            const toolCalls: { name: string; args: unknown; result: unknown }[] = [];
            
            const blocks = content.blocks || [];
            for (const block of blocks) {
              const b = block as { type?: string; name?: string; args?: unknown; result?: unknown };
              if (b.type === 'tool_call') {
                toolCalls.push({
                  name: b.name || '',
                  args: b.args,
                  result: b.result,
                });
                
                // Track file operations
                if (b.name === 'write_file') {
                  const args = b.args as { path?: string };
                  if (args?.path) filesCreated.push(args.path);
                }
              }
            }
            
            return {
              nodeId: generatedNodeId,
              content: content.getText?.() || '',
              filesCreated,
              filesModified,
              toolCalls,
            };
          }
          return null;
        };
        
        // If already complete AND not streaming, resolve immediately
        // This check prevents premature resolution when node just created but content still streaming
        if (!isNodeStreaming(generatedNodeId)) {
          const immediate = checkDone();
          if (immediate) {
            resolve(immediate);
            return;
          }
        }
        
        // Otherwise, wait for streaming to complete
        const unsubscribe = onStreamingChange(generatedNodeId, (streaming: boolean) => {
          if (!streaming) {
            unsubscribe();
            const result = checkDone();
            if (result) {
              resolve(result);
            } else {
              resolve({
                nodeId: generatedNodeId,
                content: '',
                filesCreated: [],
                filesModified: [],
                toolCalls: [],
              });
            }
          }
        });
        
        // Timeout after 5 minutes
        setTimeout(() => {
          unsubscribe();
          const result = checkDone();
          resolve(result || {
            nodeId: generatedNodeId,
            content: '',
            filesCreated: [],
            filesModified: [],
            toolCalls: [],
          });
        }, 5 * 60 * 1000);
      });
    },
  };
}
