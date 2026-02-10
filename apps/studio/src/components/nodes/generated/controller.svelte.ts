/**
 * GeneratedNode Controller
 * 
 * Handles GeneratedNode-specific logic:
 * - Regeneration using historical snapshots
 * - Streaming generation state management
 * - Version control handler registration
 * - VFS cleanup/branching on regenerate
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	GeneratedNodeData,
	InputNodeData,
	VFSNodeData
} from '$lib/types';
import type { FlowNodeData } from '$lib/types/flow';
import type { GeneratedContent, InputContent } from '$lib/types';
import type { MessageBlock } from '@pubwiki/chat';
import { generateContentHash, registerVersionHandler, type NodeRef } from '$lib/version';
import { computeNodeCommit } from '@pubwiki/api';
import { resolvePromptContentFromRefs } from '$lib/graph';
import { nodeStore, layoutStore } from '$lib/persistence';
import { getVfsController } from '../vfs/controller.svelte';
import { 
	PubChat, 
	MemoryMessageStore, 
	createSystemMessage, 
	generateBlockId, 
	blocksToContent 
} from '@pubwiki/chat';

// ============================================================================
// Streaming Event System
// ============================================================================

/**
 * Event system for streaming state changes.
 * Supports multiple subscribers per node - critical for both UI components
 * and awaitGeneration to receive notifications.
 */
type StreamingCallback = (streaming: boolean) => void;
const streamingCallbacks = new Map<string, Set<StreamingCallback>>();
const pendingStreaming = new Set<string>();
const abortCallbacks = new Map<string, () => void>();

/**
 * Register a callback for streaming state changes.
 * If the node is already streaming, callback is called immediately with true.
 * Returns unsubscribe function.
 * 
 * Note: Multiple callbacks can be registered per node. This is required because
 * both the UI component (GeneratedNode.svelte) and awaitGeneration() may
 * subscribe to the same node's streaming state simultaneously.
 */
export function onStreamingChange(nodeId: string, callback: StreamingCallback): () => void {
	let callbacks = streamingCallbacks.get(nodeId);
	if (!callbacks) {
		callbacks = new Set();
		streamingCallbacks.set(nodeId, callbacks);
	}
	callbacks.add(callback);
	
	// If already streaming when registered, notify immediately
	if (pendingStreaming.has(nodeId)) {
		callback(true);
	}
	return () => {
		const cbs = streamingCallbacks.get(nodeId);
		if (cbs) {
			cbs.delete(callback);
			if (cbs.size === 0) {
				streamingCallbacks.delete(nodeId);
			}
		}
	};
}

/**
 * Notify streaming state change for a node.
 * Called by controllers when streaming starts/ends.
 * Notifies all registered callbacks for this node.
 */
export function notifyStreamingChange(nodeId: string, streaming: boolean): void {
	if (streaming) {
		pendingStreaming.add(nodeId);
	} else {
		pendingStreaming.delete(nodeId);
		abortCallbacks.delete(nodeId);
	}
	const callbacks = streamingCallbacks.get(nodeId);
	if (callbacks) {
		for (const callback of callbacks) {
			callback(streaming);
		}
	}
}

/**
 * Register an abort callback for a streaming node.
 * Called by streamGeneration when streaming starts.
 */
export function registerAbortCallback(nodeId: string, abort: () => void): void {
	abortCallbacks.set(nodeId, abort);
}

/**
 * Abort generation for a node.
 * Returns true if abort was triggered, false if node was not streaming.
 */
export function abortGeneration(nodeId: string): boolean {
	const abort = abortCallbacks.get(nodeId);
	if (abort) {
		abort();
		return true;
	}
	return false;
}

/**
 * Check if a node is currently streaming.
 */
export function isNodeStreaming(nodeId: string): boolean {
	return pendingStreaming.has(nodeId);
}

// ============================================================================
// Types
// ============================================================================

export interface GenerationConfig {
	apiKey: string;
	model: string;
	baseUrl: string;
	/** Temperature for generation (0-2), optional */
	temperature?: number;
	/** JSON Schema for structured output, optional */
	schema?: string;
}

export interface StreamGenerationCallbacks {
	onToken: (nodeId: string, accumulatedContent: string) => void;
	onToolCall: (nodeId: string, toolCallId: string, name: string, args: unknown) => void;
	onToolResult: (nodeId: string, toolCallId: string, result: unknown) => void;
	onDone: (nodeId: string, finalContent: string, commit: string) => void;
	onError: (nodeId: string, error: Error) => void;
}

// ============================================================================
// Version Handler Registration
// ============================================================================

/**
 * Register version handler for GENERATED nodes.
 * Only defines getVersionRefs since content is now structured.
 */
registerVersionHandler<GeneratedNodeData>('GENERATED', {
	getVersionRefs: (data) => {
		const content = data.content as GeneratedContent;
		const refs = [
			content.inputRef,
			...content.promptRefs,
			...(content.indirectPromptRefs || [])
		];
		
		// Include inputVfsRef if present (for file modification scenarios)
		if (content.inputVfsRef) {
			refs.push({
				id: content.inputVfsRef.nodeId,
				commit: content.inputVfsRef.commit
			});
		}
		
		return refs;
	}
});

// ============================================================================
// PubChat Factory
// ============================================================================

/**
 * Create a new PubChat instance with the given configuration.
 * PubChat is constructed on-demand so that user settings changes are reflected immediately.
 */
export function createPubChat(config: GenerationConfig): PubChat {
	return new PubChat({
		llm: {
			apiKey: config.apiKey,
			model: config.model,
			baseUrl: config.baseUrl
		},
		messageStore: new MemoryMessageStore(),
		toolCalling: {
			enabled: true,
			maxIterations: 10000
		}
	});
}

// ============================================================================
// Stream Generation
// ============================================================================

/**
 * Stream generation to a node
 * This is the core streaming logic shared by both generate and regenerate.
 * PubChat is created on-demand so user settings changes take effect immediately.
 * 
 * @param config - LLM configuration (apiKey, model, baseUrl)
 * @param nodeId - The ID of the node to stream to
 * @param userContent - The user's input content
 * @param systemPrompt - Optional system prompt
 * @param callbacks - Callbacks for streaming events
 * @param pubchat - Optional pre-configured PubChat instance (for VFS support)
 */
export async function streamGeneration(
	config: GenerationConfig,
	nodeId: string,
	userContent: string,
	systemPrompt: string,
	callbacks: StreamGenerationCallbacks,
	pubchat?: PubChat
): Promise<void> {
	// Create PubChat on-demand if not provided
	const chat = pubchat ?? createPubChat(config);
	
	// Register abort callback
	registerAbortCallback(nodeId, () => chat.abort());

	try {
		let historyId: string | undefined;
		if (systemPrompt) {
			const systemMessage = createSystemMessage(systemPrompt, null);
			const historyIds = await chat.addConversation([systemMessage]);
			historyId = historyIds[historyIds.length - 1];
		}

		// Build override config for model, temperature and schema
		const overrideConfig: {
			model?: string;
			temperature?: number;
			responseFormat?: { type: 'json_schema'; json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean } };
		} = {};
		
		// Always pass model to ensure it overrides any default
		if (config.model) {
			overrideConfig.model = config.model;
		}
		
		if (config.temperature !== undefined) {
			overrideConfig.temperature = config.temperature;
		}
		
		if (config.schema) {
			try {
				const schemaObj = JSON.parse(config.schema) as Record<string, unknown>;
				overrideConfig.responseFormat = {
					type: 'json_schema',
					json_schema: {
						name: 'structured_output',
						schema: schemaObj,
						strict: true
					}
				};
			} catch (e) {
				console.warn('Invalid JSON schema, ignoring:', e);
			}
		}

		let accumulatedContent = '';
		for await (const event of chat.streamChat(userContent, historyId, overrideConfig)) {
			if (event.type === 'token') {
				accumulatedContent += event.token;
				callbacks.onToken(nodeId, accumulatedContent);
			} else if (event.type === 'tool_call') {
				callbacks.onToolCall(nodeId, event.id, event.name, event.args);
			} else if (event.type === 'tool_result') {
				callbacks.onToolResult(nodeId, event.id, event.result);
			} else if (event.type === 'done') {
				// Note: finalCommit here is just contentHash, actual commit will be computed later
				const finalContentHash = await generateContentHash(accumulatedContent);
				callbacks.onDone(nodeId, accumulatedContent, finalContentHash);
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
	/** Called to update a specific node's data */
	updateNodeData: (nodeId: string, updater: (data: StudioNodeData) => StudioNodeData) => void;
	/** Called to update flow nodes */
	updateNodes: (updater: (nodes: Node<FlowNodeData>[]) => Node<FlowNodeData>[]) => void;
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
 * For VFS scenarios:
 * - File creation (no inputVfsRef): Deletes the associated output VFS and re-creates on demand
 * - File modification (has inputVfsRef): Creates a new branch based on the base commit
 * 
 * After layer separation:
 * - Uses FlowNodeData for flow layer
 * - Uses nodeStore for business data
 * 
 * @param config - LLM configuration (apiKey, model, baseUrl)
 * @param generatedNodeId - The ID of the generated node to regenerate
 * @param nodes - Current nodes array (flow layer)
 * @param edges - Current edges array
 * @param callbacks - Callbacks for state updates
 */
export async function regenerate(
	config: GenerationConfig,
	generatedNodeId: string,
	nodes: Node<FlowNodeData>[],
	edges: Edge[],
	callbacks: RegenerationCallbacks
): Promise<void> {
	const genData = nodeStore.get(generatedNodeId) as GeneratedNodeData | undefined;
	if (!genData || genData.type !== 'GENERATED') {
		throw new Error('Invalid generated node');
	}

	const genContent = genData.content as GeneratedContent;

	// Get the historical input content
	const inputData = nodeStore.get(genContent.inputRef.id) as InputNodeData | undefined;
	let inputContent: string;
	
	// If the input ref points to an old version, get it from nodeStore.getVersion
	if (inputData && inputData.commit === genContent.inputRef.commit) {
		// Current version matches the ref - use current content (getText handles blocks)
		inputContent = inputData.content.getText();
	} else {
		// Different version - get from nodeStore (historical version)
		const snapshot = await nodeStore.getVersion(genContent.inputRef.id, genContent.inputRef.commit);
		if (!snapshot) {
			throw new Error('Cannot find historical input snapshot');
		}
		// Content is now a class instance with getText() method
		inputContent = snapshot.content.getText();
	}

	// Combine all refs for content resolution
	const allRefs = [
		...genContent.promptRefs, 
		...(genContent.indirectPromptRefs || [])
	];

	// Resolve each direct prompt ref with reftag substitution (now async)
	const resolvedPrompts: string[] = [];
	for (const promptRef of genContent.promptRefs) {
		const resolved = await resolvePromptContentFromRefs(
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

	// Handle VFS cleanup/branching for regeneration
	// Scenario 1: File creation (no inputVfsRef) - delete the output VFS
	// Scenario 2: File modification (has inputVfsRef) - create new branch from base commit
	if (!genContent.inputVfsRef && genContent.outputVfsId) {
		// File creation scenario: delete the associated VFS node
		const vfsNodeId = genContent.outputVfsId;
		
		// Remove VFS node and its edges from flow
		callbacks.updateNodes(nodes => nodes.filter(n => n.id !== vfsNodeId));
		callbacks.updateEdges(edges => edges.filter(e => e.source !== vfsNodeId && e.target !== vfsNodeId));
		
		// Remove from stores
		nodeStore.delete(vfsNodeId);
		layoutStore.delete(vfsNodeId);
		
		// Clear outputVfsId in the generated node
		nodeStore.update(generatedNodeId, (data) => {
			const gen = data as GeneratedNodeData;
			return {
				...gen,
				content: gen.content.withOutputVfs(null)
			};
		});
		
		console.log('[Regenerate] Deleted output VFS for file creation scenario:', vfsNodeId);
	} else if (genContent.inputVfsRef && genContent.outputVfsId) {
		// File modification scenario: create new branch from base commit
		const { nodeId: vfsNodeId, commit: baseCommit } = genContent.inputVfsRef;
		const vfsData = nodeStore.get(vfsNodeId) as VFSNodeData | undefined;
		
		if (vfsData) {
			try {
				const vfsController = await getVfsController(vfsData.content.projectId, vfsNodeId);
				
				// Create a new branch for this regeneration
				const branchName = `gen-${generatedNodeId}-${Date.now()}`;
				await vfsController.vfs.createBranch(branchName, baseCommit);
				await vfsController.vfs.checkout(branchName);
				
				console.log('[Regenerate] Created new branch for file modification:', branchName);
			} catch (e) {
				console.warn('[Regenerate] Failed to create branch for VFS:', e);
			}
		}
	}

	// Notify streaming start and clear blocks via nodeStore
	notifyStreamingChange(generatedNodeId, true);
	nodeStore.update(generatedNodeId, (data) => {
		const genData = data as GeneratedNodeData;
		return {
			...genData,
			content: genData.content.withBlocks([])
		};
	});

	// Helper to update blocks in a generated node
	const updateBlocks = (nodeId: string, updater: (blocks: MessageBlock[]) => MessageBlock[]) => {
		const currentData = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
		if (currentData && currentData.type === 'GENERATED') {
			const newBlocks = updater(currentData.content.blocks || []);
			nodeStore.update(nodeId, (data) => {
				const genData = data as GeneratedNodeData;
				return {
					...genData,
					content: genData.content.withBlocks(newBlocks)
				};
			});
		}
	};

	// Define stream callbacks using MessageBlock model
	const streamCallbacks: StreamGenerationCallbacks = {
		onToken: (nodeId, accumulatedContent) => {
			updateBlocks(nodeId, (blocks) => {
				// Find the last markdown block that isn't followed by a tool_call
				const lastBlock = blocks[blocks.length - 1];
				if (lastBlock && lastBlock.type === 'markdown') {
					// Update existing markdown block
					return blocks.map((b, i) =>
						i === blocks.length - 1
							? { ...b, content: accumulatedContent }
							: b
					);
				} else {
					// Create new markdown block
					const newBlock: MessageBlock = {
						id: generateBlockId(),
						type: 'markdown',
						content: accumulatedContent
					};
					return [...blocks, newBlock];
				}
			});
		},
		onToolCall: (nodeId, toolCallId, name, args) => {
			updateBlocks(nodeId, (blocks) => {
				// Add a new tool_call block
				const toolCallBlock: MessageBlock = {
					id: generateBlockId(),
					type: 'tool_call',
					content: '',
					toolCallId,
					toolName: name,
					toolArgs: args,
					toolStatus: 'running'
				};
				return [...blocks, toolCallBlock];
			});
		},
		onToolResult: (nodeId, toolCallId, result) => {
			updateBlocks(nodeId, (blocks) => {
				// Update the tool_call block status and add a tool_result block
				const updatedBlocks = blocks.map(b =>
					b.type === 'tool_call' && b.toolCallId === toolCallId
						? { ...b, toolStatus: 'completed' as const }
						: b
				);
				// Add tool_result block
				const resultBlock: MessageBlock = {
					id: generateBlockId(),
					type: 'tool_result',
					content: typeof result === 'string' ? result : JSON.stringify(result),
					toolCallId
				};
				return [...updatedBlocks, resultBlock];
			});
		},
		onDone: async (nodeId, _finalContent, _finalCommit) => {
			// Notify streaming complete
			notifyStreamingChange(nodeId, false);
			
			// Compute and update commit hash
			const updatedData = nodeStore.get(nodeId) as GeneratedNodeData | undefined;
			if (updatedData && updatedData.type === 'GENERATED') {
				const blocksJson = JSON.stringify(updatedData.content.blocks || []);
				const contentHash = await generateContentHash(blocksJson);
				const commit = await computeNodeCommit(nodeId, updatedData.parent, contentHash, 'GENERATED');
				nodeStore.update(nodeId, (data) => ({
					...data,
					commit,
					contentHash
				}));
			}
			
			callbacks.onComplete?.();
		},
		onError: (nodeId, _error) => {
			// Notify streaming complete on error
			notifyStreamingChange(nodeId, false);
		}
	};

	// Stream regeneration (don't await - let it run in background)
	streamGeneration(config, generatedNodeId, inputContent, systemPrompt, streamCallbacks)
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
