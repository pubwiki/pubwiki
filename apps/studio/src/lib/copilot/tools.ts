/**
 * Orchestrator Tools
 * 
 * Tool definitions for the Copilot Orchestrator Agent.
 * These tools allow the Agent to query and modify the flow graph.
 * 
 * Note: All tools use node NAMES (not IDs) to identify nodes.
 * This makes it easier for LLMs to work with nodes using semantic names.
 */

import { z } from 'zod';
import type { GraphQueryInterface } from './graph-query';
import type { GraphMutationInterface } from './graph-mutation';
import type { ToolRegistration, ToolHandler } from '@pubwiki/chat';
import { nodeStore } from '$lib/persistence';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve a node name to its ID
 * Returns undefined if not found
 */
function resolveNodeName(nodeName: string): string | undefined {
  return nodeStore.getIdByName(nodeName);
}

// ============================================================================
// Helper type for typed handlers
// ============================================================================

type TypedHandler<T, R> = (args: T) => Promise<R>;

/**
 * Create a tool handler with proper typing
 */
function handler<T, R>(fn: TypedHandler<T, R>): ToolHandler {
  return fn as ToolHandler;
}

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Create all orchestrator tools
 * @param getGraphQuery - Getter function to get the latest GraphQueryInterface (refreshed each call)
 * @param graphMutation - GraphMutationInterface for modifications
 */
export function createOrchestratorTools(
  getGraphQuery: () => GraphQueryInterface,
  graphMutation: GraphMutationInterface
): ToolRegistration[] {
  return [
    // =========================================================================
    // Query Tools
    // =========================================================================
    
    {
      name: 'get_graph_overview',
      description: 'Get an overview of the current flow graph, including all nodes and connections. Use this first to understand the current state.',
      schema: z.object({}),
      handler: handler(async () => {
        return getGraphQuery().describeGraph();
      }),
    },
    
    {
      name: 'get_node_detail',
      description: 'Get detailed information about a specific node, including its full content.',
      schema: z.object({
        nodeName: z.string().describe('The node name to get details for'),
      }),
      handler: handler(async ({ nodeName }: { nodeName: string }) => {
        const nodeId = resolveNodeName(nodeName);
        if (!nodeId) {
          return { error: `Node not found: "${nodeName}"` };
        }
        return getGraphQuery().explainNode(nodeId);
      }),
    },
    
    {
      name: 'find_nodes',
      description: 'Find nodes matching certain criteria.',
      schema: z.object({
        type: z.enum(['INPUT', 'PROMPT', 'GENERATED', 'VFS', 'SANDBOX', 'LOADER', 'STATE'])
          .optional()
          .describe('Filter by node type'),
        namePattern: z.string().optional().describe('Regex pattern to match node names'),
        contentPattern: z.string().optional().describe('Regex pattern to match node content'),
      }),
      handler: handler(async (query: { type?: string; namePattern?: string; contentPattern?: string }) => {
        const results = getGraphQuery().findNodes(query as any);
        if (results.length === 0) {
          return 'No nodes found matching the criteria.';
        }
        return results.map(n => `- "${n.name || '(unnamed)'}" [${n.type}]`).join('\n');
      }),
    },
    
    {
      name: 'list_vfs_files',
      description: 'List files in a VFS node.',
      schema: z.object({
        vfsNodeName: z.string().describe('The VFS node name'),
        path: z.string().default('/').describe('Directory path to list'),
      }),
      handler: handler(async ({ vfsNodeName, path }: { vfsNodeName: string; path: string }) => {
        const vfsNodeId = resolveNodeName(vfsNodeName);
        if (!vfsNodeId) {
          return { error: `VFS node not found: "${vfsNodeName}"` };
        }
        const files = await getGraphQuery().getVfsContents(vfsNodeId, path);
        if (files.length === 0) {
          return `No files found in ${path}`;
        }
        return files.map(f => `${f.isDirectory ? '📁' : '📄'} ${f.name}`).join('\n');
      }),
    },
    
    // =========================================================================
    // Creation Tools
    // =========================================================================
    
    {
      name: 'create_prompt_node',
      description: 'Create a new Prompt node (system prompt). Use this for reusable instructions or personas.',
      schema: z.object({
        name: z.string().describe('Unique node name'),
        content: z.string().describe('The prompt content'),
        relativeTo: z.string().optional().describe('Position relative to this node name'),
      }),
      handler: handler(async ({ name, content, relativeTo }: { name: string; content: string; relativeTo?: string }) => {
        const relativeToId = relativeTo ? resolveNodeName(relativeTo) : undefined;
        if (relativeTo && !relativeToId) {
          return { error: `Reference node not found: "${relativeTo}"` };
        }
        const nodeId = await graphMutation.createNode({
          type: 'PROMPT',
          name,
          content,
          relativeTo: relativeToId ? { nodeId: relativeToId, direction: 'left' } : undefined,
        });
        return { success: true, nodeName: name, message: `Created Prompt node "${name}"` };
      }),
    },
    
    {
      name: 'create_input_node',
      description: 'Create a new Input node (execution node). This is a Sub-Agent that will execute the task when triggered.',
      schema: z.object({
        name: z.string().describe('Unique node name'),
        content: z.string().describe('The input/task description. Can include @tag references.'),
        systemPromptNodeName: z.string().optional().describe('Connect to this Prompt node as system prompt'),
        vfsNodeName: z.string().optional().describe('Connect to this VFS node for file operations'),
      }),
      handler: handler(async (params: { name: string; content: string; systemPromptNodeName?: string; vfsNodeName?: string }) => {
        // Resolve node names to IDs
        let systemPromptNodeId: string | undefined;
        let vfsNodeId: string | undefined;
        
        if (params.systemPromptNodeName) {
          systemPromptNodeId = resolveNodeName(params.systemPromptNodeName);
          if (!systemPromptNodeId) {
            return { error: `System prompt node not found: "${params.systemPromptNodeName}"` };
          }
        }
        
        if (params.vfsNodeName) {
          vfsNodeId = resolveNodeName(params.vfsNodeName);
          if (!vfsNodeId) {
            return { error: `VFS node not found: "${params.vfsNodeName}"` };
          }
        }
        
        // Create the input node
        const nodeId = await graphMutation.createNode({
          type: 'INPUT',
          name: params.name,
          content: params.content,
          relativeTo: systemPromptNodeId 
            ? { nodeId: systemPromptNodeId, direction: 'right' }
            : vfsNodeId 
              ? { nodeId: vfsNodeId, direction: 'bottom' }
              : undefined,
        });
        
        // Connect to system prompt if specified
        if (systemPromptNodeId) {
          await graphMutation.connectNodes({
            sourceNodeId: systemPromptNodeId,
            targetNodeId: nodeId,
            connectionType: 'system',
          });
        }
        
        // Connect to VFS if specified
        if (vfsNodeId) {
          await graphMutation.connectNodes({
            sourceNodeId: vfsNodeId,
            targetNodeId: nodeId,
            connectionType: 'vfs',
          });
        }
        
        return { 
          success: true, 
          nodeName: params.name, 
          message: `Created Input node "${params.name}"${params.systemPromptNodeName ? ' with system prompt' : ''}${params.vfsNodeName ? ' with VFS connection' : ''}` 
        };
      }),
    },
    
    {
      name: 'create_vfs_node',
      description: 'Create a new VFS node (file storage). Files created by Sub-Agents will be stored here.',
      schema: z.object({
        name: z.string().describe('Unique node name (also used as folder name)'),
      }),
      handler: handler(async ({ name }: { name: string }) => {
        const nodeId = await graphMutation.createNode({
          type: 'VFS',
          name,
        });
        return { success: true, nodeName: name, message: `Created VFS node "${name}"` };
      }),
    },
    
    {
      name: 'create_sandbox_node',
      description: 'Create a new Sandbox node (preview). Connect a VFS to preview web content.',
      schema: z.object({
        name: z.string().describe('Unique node name'),
        vfsNodeName: z.string().optional().describe('Connect to this VFS node'),
      }),
      handler: handler(async ({ name, vfsNodeName }: { name: string; vfsNodeName?: string }) => {
        let vfsNodeId: string | undefined;
        if (vfsNodeName) {
          vfsNodeId = resolveNodeName(vfsNodeName);
          if (!vfsNodeId) {
            return { error: `VFS node not found: "${vfsNodeName}"` };
          }
        }
        
        const nodeId = await graphMutation.createNode({
          type: 'SANDBOX',
          name,
          relativeTo: vfsNodeId ? { nodeId: vfsNodeId, direction: 'right' } : undefined,
        });
        
        if (vfsNodeId) {
          await graphMutation.connectNodes({
            sourceNodeId: vfsNodeId,
            targetNodeId: nodeId,
            connectionType: 'vfs',
          });
        }
        
        return { success: true, nodeName: name, message: `Created Sandbox node "${name}"` };
      }),
    },
    
    {
      name: 'create_loader_node',
      description: 'Create a new Loader node (Lua backend service). Connect a VFS containing Lua scripts.',
      schema: z.object({
        name: z.string().describe('Unique node name'),
        vfsNodeName: z.string().describe('VFS node name containing Lua scripts'),
        stateNodeName: z.string().optional().describe('State node name for data persistence'),
      }),
      handler: handler(async ({ name, vfsNodeName, stateNodeName }: { name: string; vfsNodeName: string; stateNodeName?: string }) => {
        const vfsNodeId = resolveNodeName(vfsNodeName);
        if (!vfsNodeId) {
          return { error: `VFS node not found: "${vfsNodeName}"` };
        }
        
        let stateNodeId: string | undefined;
        if (stateNodeName) {
          stateNodeId = resolveNodeName(stateNodeName);
          if (!stateNodeId) {
            return { error: `State node not found: "${stateNodeName}"` };
          }
        }
        
        const nodeId = await graphMutation.createNode({
          type: 'LOADER',
          name,
          relativeTo: { nodeId: vfsNodeId, direction: 'right' },
        });
        
        // Connect VFS
        await graphMutation.connectNodes({
          sourceNodeId: vfsNodeId,
          targetNodeId: nodeId,
          connectionType: 'vfs',
        });
        
        // Connect State if specified
        if (stateNodeId) {
          await graphMutation.connectNodes({
            sourceNodeId: stateNodeId,
            targetNodeId: nodeId,
            connectionType: 'default',
          });
        }
        
        return { success: true, nodeName: name, message: `Created Loader node "${name}"` };
      }),
    },
    
    {
      name: 'create_state_node',
      description: 'Create a new State node (data storage). Used for persistent data in Lua services.',
      schema: z.object({
        name: z.string().describe('Unique node name'),
      }),
      handler: handler(async ({ name }: { name: string }) => {
        const nodeId = await graphMutation.createNode({
          type: 'STATE',
          name,
        });
        return { success: true, nodeName: name, message: `Created State node "${name}"` };
      }),
    },
    
    // =========================================================================
    // Connection Tools
    // =========================================================================
    
    {
      name: 'connect_nodes',
      description: 'Connect two nodes together.',
      schema: z.object({
        sourceNodeName: z.string().describe('Source node name'),
        targetNodeName: z.string().describe('Target node name'),
        connectionType: z.enum(['reftag', 'system', 'vfs', 'service', 'default'])
          .describe('Type of connection'),
        tagName: z.string().optional().describe('Tag name for reftag connections'),
      }),
      handler: handler(async (params: { sourceNodeName: string; targetNodeName: string; connectionType: string; tagName?: string }) => {
        const sourceNodeId = resolveNodeName(params.sourceNodeName);
        if (!sourceNodeId) {
          return { error: `Source node not found: "${params.sourceNodeName}"` };
        }
        
        const targetNodeId = resolveNodeName(params.targetNodeName);
        if (!targetNodeId) {
          return { error: `Target node not found: "${params.targetNodeName}"` };
        }
        
        if (sourceNodeId === targetNodeId) {
          return { error: `Cannot connect a node to itself` };
        }
        
        // Get node types to validate and auto-correct connection direction
        const sourceData = nodeStore.get(sourceNodeId);
        const targetData = nodeStore.get(targetNodeId);
        
        let finalSourceId = sourceNodeId;
        let finalTargetId = targetNodeId;
        let finalSourceName = params.sourceNodeName;
        let finalTargetName = params.targetNodeName;
        let swapped = false;
        
        // Auto-correct VFS connection direction: VFS should be source, Input/Sandbox should be target
        if (params.connectionType === 'vfs') {
          const sourceType = sourceData?.type;
          const targetType = targetData?.type;
          
          // If source is INPUT/SANDBOX and target is VFS, swap them
          if ((sourceType === 'INPUT' || sourceType === 'SANDBOX') && targetType === 'VFS') {
            finalSourceId = targetNodeId;
            finalTargetId = sourceNodeId;
            finalSourceName = params.targetNodeName;
            finalTargetName = params.sourceNodeName;
            swapped = true;
          }
        }
        
        try {
          const edgeId = await graphMutation.connectNodes({
            sourceNodeId: finalSourceId,
            targetNodeId: finalTargetId,
            connectionType: params.connectionType as any,
            tagName: params.tagName,
          });
          const message = swapped 
            ? `Connected "${finalSourceName}" to "${finalTargetName}" (direction auto-corrected for VFS connection)`
            : `Connected "${finalSourceName}" to "${finalTargetName}"`;
          return { success: true, edgeId, message };
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          return { error: `Failed to connect nodes: ${message}` };
        }
      }),
    },
    
    // =========================================================================
    // Execution Tools
    // =========================================================================
    
    {
      name: 'execute_input',
      description: 'Execute an Input node to trigger the Sub-Agent. Waits for completion and returns the result including: files created/modified, tool call count, and content preview. The Sub-Agent will perform the actual work (writing files, generating content, etc.).',
      schema: z.object({
        inputNodeName: z.string().describe('The Input node name to execute'),
      }),
      handler: handler(async ({ inputNodeName }: { inputNodeName: string }) => {
        const inputNodeId = resolveNodeName(inputNodeName);
        if (!inputNodeId) {
          return { error: `Input node not found: "${inputNodeName}"` };
        }
        
        const result = await graphMutation.triggerGeneration(inputNodeId);
        
        if (!result.success) {
          return { success: false, error: 'Generation failed to start' };
        }
        
        // Always wait for generation to complete
        const content = await graphMutation.awaitGeneration(result.generatedNodeId);
        const generatedNode = nodeStore.get(result.generatedNodeId);
        return {
          success: true,
          generatedNodeName: generatedNode?.name || result.generatedNodeId,
          filesCreated: content.filesCreated,
          filesModified: content.filesModified,
          toolCallCount: content.toolCalls.length,
          contentPreview: content.content.slice(0, 200) + (content.content.length > 200 ? '...' : ''),
        };
      }),
    },
    
    {
      name: 'update_node_content',
      description: 'Update the content of an existing Prompt or Input node.',
      schema: z.object({
        nodeName: z.string().describe('The node name to update'),
        content: z.string().describe('New content'),
      }),
      handler: handler(async ({ nodeName, content }: { nodeName: string; content: string }) => {
        const nodeId = resolveNodeName(nodeName);
        if (!nodeId) {
          return { error: `Node not found: "${nodeName}"` };
        }
        await graphMutation.updateNodeContent(nodeId, { text: content });
        return { success: true, message: `Updated node "${nodeName}" content` };
      }),
    },
    
    {
      name: 'delete_node',
      description: 'Delete a node and its connections.',
      schema: z.object({
        nodeName: z.string().describe('The node name to delete'),
      }),
      handler: handler(async ({ nodeName }: { nodeName: string }) => {
        const nodeId = resolveNodeName(nodeName);
        if (!nodeId) {
          return { error: `Node not found: "${nodeName}"` };
        }
        await graphMutation.deleteNode(nodeId);
        return { success: true, message: `Deleted node "${nodeName}"` };
      }),
    },
  ];
}
