/**
 * Copilot Types
 * 
 * Type definitions for the Studio Copilot feature.
 */

import type { NodeType } from '$lib/types/content';

// ============================================================================
// Graph Query Types
// ============================================================================

/**
 * Summary information about a node
 */
export interface NodeSummary {
  id: string;
  type: NodeType;
  name: string;
  preview: string;        // Content preview (truncated)
  hasVersions: boolean;   // Has version history
}

/**
 * Detailed information about a node
 */
export interface NodeDetail extends NodeSummary {
  fullContent: string;    // Full content
  commit: string;         // Current version
  parent: string | null;  // Parent commit for version lineage
  createdFrom?: string;   // e.g., "Generated from xxx Input"
}

/**
 * Edge information
 */
export interface EdgeInfo {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  targetHandle?: string;
  connectionType: ConnectionType;
}

/**
 * Query for finding nodes
 */
export interface NodeQuery {
  type?: NodeType;
  namePattern?: string;
  contentPattern?: string;
}

/**
 * Version information
 */
export interface VersionInfo {
  commit: string;
  timestamp?: number;
  preview: string;
}

/**
 * VFS file information
 */
export interface VfsFileInfo {
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
}

// ============================================================================
// Graph Mutation Types
// ============================================================================

/**
 * Connection types between nodes
 */
export type ConnectionType = 'reftag' | 'system' | 'vfs' | 'service' | 'default';

/**
 * Parameters for creating a new node
 */
export interface CreateNodeParams {
  type: NodeType;
  name?: string;
  content?: string;
  position?: { x: number; y: number };
  relativeTo?: {
    nodeId: string;
    direction: 'right' | 'bottom' | 'left' | 'top';
  };
}

/**
 * Parameters for connecting nodes
 */
export interface ConnectParams {
  sourceNodeId: string;
  targetNodeId: string;
  connectionType: ConnectionType;
  tagName?: string;  // For reftag connections
}

/**
 * Node content update
 */
export interface NodeContentUpdate {
  text?: string;
  blocks?: unknown[];
}

/**
 * Generation result
 */
export interface GenerationResult {
  generatedNodeId: string;
  inputNodeId: string;
  success: boolean;
}

/**
 * Generated content result
 */
export interface GeneratedContentResult {
  nodeId: string;
  content: string;
  filesCreated: string[];
  filesModified: string[];
  toolCalls: ToolCallInfo[];
}

/**
 * Tool call info
 */
export interface ToolCallInfo {
  name: string;
  args: unknown;
  result: unknown;
}

// ============================================================================
// Execution Context Types
// ============================================================================

/**
 * Execution context for Sub-Agent
 */
export interface ExecutionContext {
  systemPrompt: string | null;
  referencedPrompts: { tag: string; content: string }[];
  availableVfs: { nodeId: string; name: string; files: string[] }[];
  conversationHistory: unknown[];
}

/**
 * Structure suggestion for a task
 */
export interface StructureSuggestion {
  description: string;
  nodes: {
    type: NodeType;
    name: string;
    purpose: string;
  }[];
  connections: {
    from: string;
    to: string;
    type: ConnectionType;
  }[];
}

// ============================================================================
// Copilot Settings
// ============================================================================

/**
 * Auto-confirm settings
 */
export interface AutoConfirmSettings {
  createNode: boolean;
  modifyContent: boolean;
  deleteNode: boolean;
  triggerGeneration: boolean;
  bulkFileChanges: number;  // Threshold for confirmation
}

/**
 * Copilot settings
 */
export interface CopilotSettings {
  autoConfirm: AutoConfirmSettings;
  granularity: 'fine' | 'coarse' | 'auto';
}

/**
 * Default copilot settings
 */
export const DEFAULT_COPILOT_SETTINGS: CopilotSettings = {
  autoConfirm: {
    createNode: true,
    modifyContent: false,
    deleteNode: false,
    triggerGeneration: true,
    bulkFileChanges: 5,
  },
  granularity: 'auto',
};
