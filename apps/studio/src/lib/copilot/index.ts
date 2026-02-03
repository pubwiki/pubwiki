/**
 * Copilot Module
 * 
 * Exports for the Studio Copilot feature - an AI assistant that helps
 * users build flow graphs through natural language interaction.
 */

// Types
export type {
  NodeSummary,
  NodeDetail,
  EdgeInfo,
  NodeQuery,
  CreateNodeParams,
  ConnectParams,
  ConnectionType,
  GenerationResult,
  GeneratedContentResult,
  CopilotSettings,
  AutoConfirmSettings,
} from './types';

// Graph Abstraction Layer
export { createGraphQuery, type GraphQueryInterface } from './graph-query';
export { createGraphMutation, type GraphMutationInterface, type FlowCallbacks, type GenerationSettings } from './graph-mutation';

// Orchestrator
export { 
  CopilotOrchestrator, 
  createCopilotOrchestrator,
  type OrchestratorConfig,
} from './orchestrator';

// Tools (for advanced use cases)
export { createOrchestratorTools } from './tools';
