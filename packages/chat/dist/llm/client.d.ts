/**
 * LLM Client - OpenAI Responses API client
 *
 * Simplified version for pubchat-core, supporting:
 * - OpenAI compatible APIs
 * - Streaming and non-streaming chat
 * - Function/tool calling
 * - Reasoning tokens (Claude, Gemini, etc.)
 */
import type { ChatMessage, StreamChunk, ChatResponse, ToolDefinition } from '../types';
export interface LLMClientConfig {
    apiKey: string;
    baseURL?: string;
    organization?: string;
    defaultHeaders?: Record<string, string>;
}
export interface ChatCompletionOptions {
    model: string;
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number;
    stream?: boolean;
    tools?: ToolDefinition[];
    tool_choice?: 'none' | 'auto' | 'required';
    signal?: AbortSignal;
}
/**
 * LLM Client - Using OpenAI Responses API
 */
export declare class LLMClient {
    private client;
    constructor(config: LLMClientConfig);
    /**
     * Streaming chat completion
     */
    streamChat(options: ChatCompletionOptions): AsyncGenerator<StreamChunk>;
    /**
     * Non-streaming chat completion
     */
    chat(options: ChatCompletionOptions): Promise<ChatResponse>;
}
//# sourceMappingURL=client.d.ts.map