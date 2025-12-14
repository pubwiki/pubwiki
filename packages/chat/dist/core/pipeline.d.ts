/**
 * Chat Stream Pipeline - Streaming chat pipeline
 *
 * Simplified version for chat:
 * - AsyncGenerator design for immediate event yielding
 * - Directly produces MessageBlock
 * - Tool calling produces independent block events
 * - No postprocessing (handled by consumers)
 */
import { ToolRegistry } from '../llm/tools';
import type { ChatMessage } from '../types/chat';
import type { MessageBlock, ToolCallStatus, ReasoningDetail } from '../types/message';
/**
 * Stream event types
 */
export type StreamEvent = {
    type: 'token';
    token: string;
    tokenType: 'text' | 'reasoning';
} | {
    type: 'block';
    block: MessageBlock;
} | {
    type: 'block_update';
    blockId: string;
    updates?: Partial<MessageBlock>;
} | {
    type: 'tool_call_start';
    block: MessageBlock;
} | {
    type: 'tool_call_complete';
    toolCallId: string;
    status: ToolCallStatus;
    resultBlock: MessageBlock;
} | {
    type: 'segment_complete';
} | {
    type: 'iteration_limit_reached';
    currentIteration: number;
    maxIterations: number;
} | {
    type: 'complete';
    summary: CompletionSummary;
};
/**
 * Completion summary
 */
export interface CompletionSummary {
    totalSegments: number;
    totalBlocks: number;
    totalToolCalls: number;
    reasoning?: string;
    reasoning_details?: ReasoningDetail[];
}
/**
 * Pipeline configuration
 */
export interface PipelineConfig {
    model: string;
    apiKey: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
    organizationId?: string;
    tools?: ToolRegistry;
    maxIterations?: number;
    onIterationLimitReached?: (currentIteration: number, maxIterations: number) => Promise<boolean>;
    signal?: AbortSignal;
}
/**
 * Chat Stream Pipeline
 *
 * Core features:
 * 1. AsyncGenerator design, each event yields immediately
 * 2. Directly produces MessageBlock
 * 3. Tool calling produces independent block events
 */
export declare class ChatStreamPipeline {
    private client;
    private config;
    constructor(config: PipelineConfig);
    /**
     * Execute streaming chat
     */
    stream(messages: ChatMessage[]): AsyncGenerator<StreamEvent>;
    /**
     * Merge tool calls
     */
    private mergeToolCalls;
}
//# sourceMappingURL=pipeline.d.ts.map