/**
 * GeneratedNode Controller
 * 
 * Handles GeneratedNode-specific logic:
 * - Regeneration using historical snapshots
 * - Streaming generation state management
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	GeneratedNodeData, 
	NodeRef 
} from '../../../utils/types';
import { snapshotStore, generateCommitHash } from '../../../utils/types';
import { resolvePromptContentFromRefs } from '../../../utils/reftag';
import { PubChat, MemoryMessageStore, createSystemMessage } from '@pubwiki/chat';

// ============================================================================
// Types
// ============================================================================

export interface GenerationConfig {
	apiKey: string;
	model: string;
	baseUrl: string;
}

export interface StreamGenerationCallbacks {
	onToken: (nodeId: string, accumulatedContent: string) => void;
	onDone: (nodeId: string, finalContent: string, commit: string) => void;
	onError: (nodeId: string, error: Error) => void;
}

// ============================================================================
// State
// ============================================================================

/** PubChat instance for generation */
let pubchat: PubChat | null = null;

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize the GeneratedNode controller with LLM configuration
 */
export function initGeneratedNodeController(config: GenerationConfig): void {
	pubchat = new PubChat({
		llm: {
			apiKey: config.apiKey,
			model: config.model,
			baseUrl: config.baseUrl
		},
		messageStore: new MemoryMessageStore(),
		toolCalling: {
			enabled: true,
			maxIterations: 10
		}
	});
}

/**
 * Get the PubChat instance (for VFS mounting in InputNode)
 */
export function getPubChat(): PubChat | null {
	return pubchat;
}

// ============================================================================
// Stream Generation
// ============================================================================

/**
 * Stream generation to a node
 * This is the core streaming logic shared by both generate and regenerate
 */
export async function streamGeneration(
	nodeId: string,
	userContent: string,
	systemPrompt: string,
	callbacks: StreamGenerationCallbacks
): Promise<void> {
	if (!pubchat) {
		throw new Error('GeneratedNode controller not initialized');
	}

	try {
		let historyId: string | undefined;
		if (systemPrompt) {
			const systemMessage = createSystemMessage(systemPrompt, null);
			const historyIds = await pubchat.addConversation([systemMessage]);
			historyId = historyIds[historyIds.length - 1];
		}

		let accumulatedContent = '';
		for await (const event of pubchat.streamChat(userContent, historyId)) {
			if (event.type === 'token') {
				accumulatedContent += event.token;
				callbacks.onToken(nodeId, accumulatedContent);
			} else if (event.type === 'done') {
				const finalCommit = await generateCommitHash(accumulatedContent);
				callbacks.onDone(nodeId, accumulatedContent, finalCommit);
			} else if (event.type === 'error') {
				console.error('Generation error:', event.error);
				callbacks.onError(nodeId, event.error);
			}
		}
	} catch (error) {
		console.error('Generation failed:', error);
		callbacks.onError(nodeId, error as Error);
	}
}

// ============================================================================
// Regeneration
// ============================================================================

/**
 * Callbacks for regeneration operations
 */
export interface RegenerationCallbacks {
	/** Called to update nodes */
	updateNodes: (updater: (nodes: Node<StudioNodeData>[]) => Node<StudioNodeData>[]) => void;
	/** Called to update edges */
	updateEdges: (updater: (edges: Edge[]) => Edge[]) => void;
	/** Called when regeneration completes successfully */
	onComplete?: () => void;
}

/**
 * Regenerate content using the historical snapshots stored in the generated node.
 * This uses the original inputRef, promptRefs, and indirectPromptRefs to 
 * reconstruct the exact context that was used for the original generation,
 * including reftag-substituted content.
 * 
 * @param generatedNodeId - The ID of the generated node to regenerate
 * @param nodes - Current nodes array
 * @param edges - Current edges array
 * @param callbacks - Callbacks for state updates
 */
export async function regenerate(
	generatedNodeId: string,
	nodes: Node<StudioNodeData>[],
	edges: Edge[],
	callbacks: RegenerationCallbacks
): Promise<void> {
	const generatedNode = nodes.find(n => n.id === generatedNodeId);
	if (!generatedNode || generatedNode.data.type !== 'GENERATED') {
		throw new Error('Invalid generated node');
	}

	const genData = generatedNode.data as GeneratedNodeData;

	// Get the historical input content
	const inputNode = nodes.find(n => n.id === genData.inputRef.id);
	let inputContent: string;
	
	// If the input ref points to an old version, get it from snapshotStore
	if (inputNode && inputNode.data.commit === genData.inputRef.commit) {
		// Current version matches the ref - use current content
		inputContent = inputNode.data.content as string;
	} else {
		// Different version - get from snapshot store
		const snapshot = snapshotStore.get<string>(genData.inputRef.id, genData.inputRef.commit);
		if (!snapshot) {
			throw new Error('Cannot find historical input snapshot');
		}
		inputContent = snapshot.content;
	}

	// Combine all refs for content resolution
	const allRefs = [
		...genData.promptRefs, 
		...(genData.indirectPromptRefs || [])
	];

	// Resolve each direct prompt ref with reftag substitution
	const resolvedPrompts: string[] = [];
	for (const promptRef of genData.promptRefs) {
		const resolved = resolvePromptContentFromRefs(
			promptRef.id,
			promptRef.commit,
			nodes,
			edges,
			allRefs,
			new Set()
		);
		resolvedPrompts.push(resolved);
	}

	const systemPrompt = resolvedPrompts.filter(Boolean).join('\n\n---\n\n');

	// Set streaming state
	callbacks.updateNodes(nodes => nodes.map(n =>
		n.id === generatedNodeId
			? { ...n, data: { ...n.data, isStreaming: true } }
			: n
	));

	// Define stream callbacks
	const streamCallbacks: StreamGenerationCallbacks = {
		onToken: (nodeId, accumulatedContent) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS'
					? { ...n, data: { ...n.data, content: accumulatedContent } }
					: n
			) as Node<StudioNodeData>[]);
		},
		onDone: (nodeId, finalContent, finalCommit) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS'
					? { ...n, data: { ...n.data, content: finalContent, commit: finalCommit, isStreaming: false } }
					: n
			) as Node<StudioNodeData>[]);
			callbacks.onComplete?.();
		},
		onError: (nodeId, _error) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type !== 'VFS' 
					? { ...n, data: { ...n.data, isStreaming: false } } 
					: n
			) as Node<StudioNodeData>[]);
		}
	};

	// Stream regeneration (don't await - let it run in background)
	streamGeneration(generatedNodeId, inputContent, systemPrompt, streamCallbacks)
		.catch(err => {
			console.error('Regeneration failed:', err);
			streamCallbacks.onError(generatedNodeId, err);
		});
}

// ============================================================================
// Registration (placeholder for future event handlers)
// ============================================================================

/**
 * Register GeneratedNode event handlers
 * Currently no flow events need handling, but this follows the pattern
 */
export function registerGeneratedNodeHandlers(): () => void {
	// No event handlers needed currently
	// Future: could handle edge connections to generated nodes
	return () => {
		// Cleanup
	};
}
