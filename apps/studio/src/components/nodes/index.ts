/**
 * Node Components for Studio Graph
 * 
 * This module exports all node type components used in the studio graph.
 * Each node type extends a common base structure for consistent behavior.
 */

// Base components
export { default as BaseNode } from './BaseNode.svelte';

// Concrete node types - organized by module
export { PromptNode } from './prompt';
export { 
	InputNode, 
	generate,
	type GenerationCallbacks
} from './input';
export { 
	GeneratedNode, 
	registerGeneratedNodeHandlers,
	createPubChat,
	regenerate,
	type GenerationConfig,
	type StreamGenerationCallbacks
} from './generated';
export { VFSNode, VFSFileEditor, registerVfsNodeHandlers } from './vfs';
export { SandboxNode, SandboxPreviewView } from './sandbox';
export { 
	LoaderNode, 
	registerLoaderNodeHandlers,
	createLoaderInterface,
	type LoaderInterface,
	type ServiceCallResult,
	type ServiceDefinition
} from './loader';
export { StateNode } from './state';

// Re-export types
export type { BaseNodeProps, NodeHeaderProps } from './types';
