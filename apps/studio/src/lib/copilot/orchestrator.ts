/**
 * Copilot Orchestrator
 * 
 * The Orchestrator Agent that interfaces with the user and coordinates
 * flow graph construction. It does NOT directly write files - all file
 * operations are delegated to Sub-Agents (Input Nodes).
 * 
 * Responsibilities:
 * - Understand user intent
 * - Query and analyze current graph state
 * - Create/connect nodes to build workflows
 * - Trigger Input node execution for actual file operations
 */

import { PubChat, MemoryMessageStore, createSystemMessage, type ChatStreamEvent, type LLMConfig } from '@pubwiki/chat';
import { createGraphQuery, type GraphQueryInterface } from './graph-query';
import { createGraphMutation, type GraphMutationInterface, type FlowCallbacks, type GenerationSettings } from './graph-mutation';
import { createOrchestratorTools } from './tools';
import type { CopilotSettings } from './types';
import type { Node, Edge } from '@xyflow/svelte';
import type { FlowNodeData } from '$lib/types/flow';

// Import system prompt from markdown file
import ORCHESTRATOR_SYSTEM_PROMPT from './prompts/orchestrator.md?raw';

// ============================================================================
// Orchestrator Configuration
// ============================================================================

export interface OrchestratorConfig {
  /** LLM configuration */
  llm: LLMConfig;
  
  /** Copilot settings */
  settings: CopilotSettings;
  
  /** Project ID for VFS creation */
  projectId: string;
  
  /** Flow state callbacks - required for graph operations */
  flowCallbacks: FlowCallbacks;
  
  /** Generation settings */
  generationSettings: GenerationSettings;
  
  /** Callback when a node is created (for UI feedback) */
  onNodeCreated?: (nodeId: string, nodeType: string, nodeName: string) => void;
  
  /** Callback when nodes are connected */
  onNodesConnected?: (sourceId: string, targetId: string) => void;
  
  /** Callback when generation starts */
  onGenerationStarted?: (inputNodeId: string, generatedNodeId: string) => void;
  
  /** Callback when generation completes */
  onGenerationCompleted?: (generatedNodeId: string) => void;
}

// ============================================================================
// Orchestrator Class
// ============================================================================

export class CopilotOrchestrator {
  private pubchat: PubChat;
  private graphQuery: GraphQueryInterface;
  private graphMutation: GraphMutationInterface;
  private config: OrchestratorConfig;
  private historyId: string | undefined;
  private initialized: boolean = false;
  
  constructor(config: OrchestratorConfig) {
    this.config = config;
    
    // Create graph interfaces with flow state
    const nodes = config.flowCallbacks.getNodes();
    const edges = config.flowCallbacks.getEdges();
    this.graphQuery = createGraphQuery(nodes, edges);
    this.graphMutation = createGraphMutation(
      config.flowCallbacks, 
      config.generationSettings, 
      config.projectId
    );
    
    // Wrap mutation methods with callbacks
    const wrappedMutation = this.wrapMutationWithCallbacks(this.graphMutation);
    
    // Create message store (in-memory for now, could use IndexedDB later)
    const messageStore = new MemoryMessageStore();
    
    // Create PubChat instance
    this.pubchat = new PubChat({
      llm: {
        model: config.llm.model,
        apiKey: config.llm.apiKey,
        baseUrl: config.llm.baseUrl,
        temperature: config.llm.temperature ?? 0.7,
        maxTokens: config.llm.maxTokens ?? 4096,
      },
      messageStore,
      toolCalling: {
        enabled: true,
        maxIterations: 20,
      },
    });
    
    // Register orchestrator tools
    // Pass a getter function so tools always access the latest graph state
    const tools = createOrchestratorTools(() => this.graphQuery, wrappedMutation);
    for (const tool of tools) {
      this.pubchat.registerTool({
        name: tool.name,
        description: tool.description,
        schema: tool.schema,
        handler: tool.handler,
      });
    }
  }
  
  /**
   * Initialize the orchestrator with system prompt
   * Must be called before the first chat message
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Create system message and add to conversation
    const systemMessage = createSystemMessage(ORCHESTRATOR_SYSTEM_PROMPT, null);
    const [historyId] = await this.pubchat.addConversation([systemMessage]);
    this.historyId = historyId;
    this.initialized = true;
  }
  
  /**
   * Ensure the orchestrator is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
  
  /**
   * Refresh graph state from callbacks
   * This ensures the orchestrator sees the latest nodes/edges
   */
  private refreshGraphState(): void {
    const nodes = this.config.flowCallbacks.getNodes();
    const edges = this.config.flowCallbacks.getEdges();
    this.graphQuery = createGraphQuery(nodes, edges);
  }
  
  /**
   * Wrap mutation interface with callbacks
   */
  private wrapMutationWithCallbacks(mutation: GraphMutationInterface): GraphMutationInterface {
    const { onNodeCreated, onNodesConnected, onGenerationStarted, onGenerationCompleted } = this.config;
    
    return {
      ...mutation,
      
      createNode: async (params) => {
        const nodeId = await mutation.createNode(params);
        onNodeCreated?.(nodeId, params.type, params.name || '');
        return nodeId;
      },
      
      connectNodes: async (params) => {
        const edgeId = await mutation.connectNodes(params);
        onNodesConnected?.(params.sourceNodeId, params.targetNodeId);
        return edgeId;
      },
      
      triggerGeneration: async (inputNodeId) => {
        const result = await mutation.triggerGeneration(inputNodeId);
        if (result.success) {
          onGenerationStarted?.(inputNodeId, result.generatedNodeId);
        }
        return result;
      },
      
      awaitGeneration: async (generatedNodeId) => {
        const result = await mutation.awaitGeneration(generatedNodeId);
        onGenerationCompleted?.(generatedNodeId);
        return result;
      },
    };
  }
  
  /**
   * Send a message to the Orchestrator (streaming)
   */
  async *chat(message: string): AsyncGenerator<ChatStreamEvent> {
    // Ensure system prompt is initialized
    await this.ensureInitialized();
    
    // Refresh graph state before each message
    this.refreshGraphState();
    
    // Stream the response
    for await (const event of this.pubchat.streamChat(message, this.historyId)) {
      yield event;
      
      // Update history ID when done
      if (event.type === 'done') {
        this.historyId = event.historyId;
      }
    }
  }
  
  /**
   * Send a message to the Orchestrator (non-streaming)
   */
  async chatSync(message: string): Promise<{ response: string; historyId: string }> {
    // Ensure system prompt is initialized
    await this.ensureInitialized();
    
    // Refresh graph state before each message
    this.refreshGraphState();
    
    const result = await this.pubchat.chat(message, this.historyId);
    this.historyId = result.historyId;
    
    // Extract text content from blocks
    const textBlocks = result.message.blocks
      .filter(b => b.type === 'text' || b.type === 'markdown')
      .map(b => b.content);
    
    return {
      response: textBlocks.join('\n'),
      historyId: result.historyId,
    };
  }
  
  /**
   * Abort current generation
   */
  abort(): void {
    this.pubchat.abort();
  }
  
  /**
   * Reset conversation history
   */
  resetHistory(): void {
    this.historyId = undefined;
  }
  
  /**
   * Get the current history ID
   */
  getHistoryId(): string | undefined {
    return this.historyId;
  }
  
  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return ORCHESTRATOR_SYSTEM_PROMPT;
  }
  
  /**
   * Update settings
   */
  updateSettings(settings: Partial<CopilotSettings>): void {
    Object.assign(this.config.settings, settings);
  }
  
  /**
   * Get graph query interface (for external use)
   */
  getGraphQuery(): GraphQueryInterface {
    return this.graphQuery;
  }
  
  /**
   * Get graph mutation interface (for external use)
   */
  getGraphMutation(): GraphMutationInterface {
    return this.graphMutation;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a Copilot Orchestrator instance
 */
export function createCopilotOrchestrator(config: OrchestratorConfig): CopilotOrchestrator {
  return new CopilotOrchestrator(config);
}
