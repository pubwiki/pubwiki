/**
 * GeneratedNode Controller
 * 
 * Handles GeneratedNode-specific logic:
 * - Regeneration using historical snapshots
 * - Streaming generation state management
 * - Version control handler registration
 */

import type { Node, Edge } from '@xyflow/svelte';
import type { 
	StudioNodeData, 
	GeneratedNodeData,
	InputNodeData
} from '../../../utils/types';
import type { GeneratedContent, InputContent } from '../../../utils/content-types';
import type { MessageBlock } from '@pubwiki/chat';
import { snapshotStore, generateCommitHash, registerVersionHandler, type NodeRef } from '../../../stores/version';
import { resolvePromptContentFromRefs } from '../../../utils/reftag';
import { 
	PubChat, 
	MemoryMessageStore, 
	createSystemMessage, 
	generateBlockId, 
	blocksToContent 
} from '@pubwiki/chat';

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
		return [
			content.inputRef,
			...content.promptRefs,
			...(content.indirectPromptRefs || [])
		];
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
			maxIterations: 10
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

	try {
		let historyId: string | undefined;
		if (systemPrompt) {
			const systemMessage = createSystemMessage(systemPrompt, null);
			const historyIds = await chat.addConversation([systemMessage]);
			historyId = historyIds[historyIds.length - 1];
		}

		let accumulatedContent = '';
		for await (const event of chat.streamChat(userContent, historyId)) {
			if (event.type === 'token') {
				accumulatedContent += event.token;
				callbacks.onToken(nodeId, accumulatedContent);
			} else if (event.type === 'tool_call') {
				callbacks.onToolCall(nodeId, event.id, event.name, event.args);
			} else if (event.type === 'tool_result') {
				callbacks.onToolResult(nodeId, event.id, event.result);
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
 * @param config - LLM configuration (apiKey, model, baseUrl)
 * @param generatedNodeId - The ID of the generated node to regenerate
 * @param nodes - Current nodes array
 * @param edges - Current edges array
 * @param callbacks - Callbacks for state updates
 */
export async function regenerate(
	config: GenerationConfig,
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
	const genContent = genData.content as GeneratedContent;

	// Get the historical input content
	const inputNode = nodes.find(n => n.id === genContent.inputRef.id);
	let inputContent: string;
	
	// If the input ref points to an old version, get it from snapshotStore
	if (inputNode && inputNode.data.commit === genContent.inputRef.commit) {
		// Current version matches the ref - use current content
		inputContent = (inputNode.data as InputNodeData).content.text;
	} else {
		// Different version - get from snapshot store
		const snapshot = snapshotStore.get<InputContent>(genContent.inputRef.id, genContent.inputRef.commit);
		if (!snapshot) {
			throw new Error('Cannot find historical input snapshot');
		}
		inputContent = snapshot.content.text;
	}

	// Combine all refs for content resolution
	const allRefs = [
		...genContent.promptRefs, 
		...(genContent.indirectPromptRefs || [])
	];

	// Resolve each direct prompt ref with reftag substitution
	const resolvedPrompts: string[] = [];
	for (const promptRef of genContent.promptRefs) {
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

	// Set streaming state and clear blocks
	callbacks.updateNodes(nodes => nodes.map(n => {
		if (n.id === generatedNodeId && n.data.type === 'GENERATED') {
			const genData = n.data as GeneratedNodeData;
			return { 
				...n, 
				data: { 
					...genData, 
					isStreaming: true, 
					content: { ...genData.content, blocks: [] } 
				} 
			};
		}
		return n;
	}) as Node<StudioNodeData>[]);

	// Helper to update blocks in a generated node
	const updateBlocks = (nodeId: string, updater: (blocks: MessageBlock[]) => MessageBlock[]) => {
		callbacks.updateNodes(nodes => nodes.map(n => {
			if (n.id === nodeId && n.data.type === 'GENERATED') {
				const genData = n.data as GeneratedNodeData;
				const genContent = genData.content as GeneratedContent;
				return {
					...n,
					data: {
						...genData,
						content: {
							...genContent,
							blocks: updater(genContent.blocks || [])
						}
					}
				};
			}
			return n;
		}) as Node<StudioNodeData>[]);
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
			// Compute commit from blocks content
			callbacks.updateNodes(nodes => nodes.map(n => {
				if (n.id === nodeId && n.data.type === 'GENERATED') {
					const genData = n.data as GeneratedNodeData;
					const genContent = genData.content as GeneratedContent;
					const content = blocksToContent(genContent.blocks || []);
					// Note: We compute commit synchronously here for simplicity
					// The actual commit will be computed after streaming is done
					return {
						...n,
						data: {
							...genData,
							isStreaming: false
						}
					};
				}
				return n;
			}) as Node<StudioNodeData>[]);
			
			// Compute and update commit hash asynchronously
			const node = nodes.find(n => n.id === nodeId);
			if (node && node.data.type === 'GENERATED') {
				const genData = node.data as GeneratedNodeData;
				const genContent = genData.content as GeneratedContent;
				const blocksJson = JSON.stringify(genContent.blocks || []);
				const commit = await generateCommitHash(blocksJson);
				callbacks.updateNodes(ns => ns.map(n =>
					n.id === nodeId && n.data.type === 'GENERATED'
						? { ...n, data: { ...n.data, commit } }
						: n
				) as Node<StudioNodeData>[]);
			}
			
			callbacks.onComplete?.();
		},
		onError: (nodeId, _error) => {
			callbacks.updateNodes(nodes => nodes.map(n => 
				n.id === nodeId && n.data.type === 'GENERATED' 
					? { ...n, data: { ...n.data, isStreaming: false } } 
					: n
			) as Node<StudioNodeData>[]);
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
