/**
 * LLM Client - OpenAI Responses API client
 *
 * Simplified version for pubchat-core, supporting:
 * - OpenAI compatible APIs
 * - Streaming and non-streaming chat
 * - Function/tool calling
 * - Reasoning tokens (Claude, Gemini, etc.)
 */
import OpenAI from 'openai';
/**
 * Type guard for reasoning item
 */
function isReasoningItem(item) {
    if (typeof item !== 'object' || item === null)
        return false;
    const obj = item;
    return obj.type === 'reasoning' && typeof obj.id === 'string';
}
/**
 * Type guard for function call
 */
function isFunctionCall(item) {
    if (typeof item !== 'object' || item === null)
        return false;
    const obj = item;
    return obj.type === 'function_call';
}
/**
 * Build EasyInputMessage
 */
function buildEasyInputMessage(role, content) {
    return { role, content };
}
/**
 * Get string content from ChatMessage
 */
function getStringContent(msg) {
    if (Array.isArray(msg.content)) {
        return msg.content
            .filter((part) => part.type === 'text')
            .map(part => part.text || '')
            .join('');
    }
    return msg.content;
}
/**
 * LLM Client - Using OpenAI Responses API
 */
export class LLMClient {
    constructor(config) {
        this.client = new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            organization: config.organization,
            defaultHeaders: config.defaultHeaders,
            dangerouslyAllowBrowser: true
        });
    }
    /**
     * Streaming chat completion
     */
    async *streamChat(options) {
        const input = [];
        for (const msg of options.messages) {
            if (msg.role === 'tool') {
                // Tool response message
                input.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id || '',
                    output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                });
            }
            else {
                const content = getStringContent(msg);
                const role = msg.role === 'system' ? 'system'
                    : msg.role === 'user' ? 'user'
                        : msg.role === 'assistant' ? 'assistant'
                            : 'developer';
                input.push(buildEasyInputMessage(role, content));
                // Handle reasoning_details for assistant messages
                if (msg.role === 'assistant' && msg.reasoning_details && msg.reasoning_details.length > 0) {
                    for (const detail of msg.reasoning_details) {
                        const reasoningItem = {
                            id: detail.id || `reasoning_${Date.now()}`,
                            type: 'reasoning',
                            summary: []
                        };
                        if (detail.type === 'reasoning.summary' && detail.summary) {
                            reasoningItem.summary = [{ type: 'summary_text', text: detail.summary }];
                        }
                        if (detail.type === 'reasoning.text' && detail.text) {
                            reasoningItem.content = [
                                { type: 'reasoning_text', text: detail.text }
                            ];
                        }
                        if (detail.type === 'reasoning.encrypted' && detail.data) {
                            reasoningItem.encrypted_content = detail.data;
                        }
                        input.push(reasoningItem);
                    }
                }
                else if (msg.role === 'assistant' && msg.reasoning) {
                    // Legacy format support
                    const reasoningItem = {
                        id: msg.reasoning_id || `reasoning_${Date.now()}`,
                        type: 'reasoning',
                        summary: [{
                                type: 'summary_text',
                                text: msg.reasoning
                            }]
                    };
                    input.push(reasoningItem);
                }
                // Handle tool_calls for assistant messages
                if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                    for (const tc of msg.tool_calls) {
                        const functionCallItem = {
                            type: 'function_call',
                            call_id: tc.id,
                            name: tc.function.name,
                            arguments: tc.function.arguments
                        };
                        input.push(functionCallItem);
                    }
                }
            }
        }
        // Convert tool definitions
        const tools = options.tools?.map(tool => ({
            type: 'function',
            name: tool.function.name,
            description: tool.function.description || undefined,
            parameters: tool.function.parameters,
            strict: null
        }));
        const params = {
            model: options.model,
            input,
            temperature: options.temperature ?? null,
            tools: tools,
            tool_choice: options.tool_choice,
            stream: true
        };
        const stream = await this.client.responses.create(params, {
            signal: options.signal
        });
        let currentToolCalls = new Map();
        let currentReasoningId = '';
        let reasoningDetails = [];
        for await (const event of stream) {
            if (event.type === 'response.output_text.delta') {
                yield {
                    content: event.delta,
                    tool_calls: undefined,
                    finish_reason: null
                };
            }
            else if (event.type === 'response.reasoning_text.delta') {
                yield {
                    content: '',
                    tool_calls: undefined,
                    finish_reason: null,
                    reasoning_details: [{
                            type: 'reasoning.text',
                            text: event.delta,
                            id: currentReasoningId || undefined
                        }]
                };
            }
            else if (event.type === 'response.reasoning_summary_text.delta') {
                yield {
                    content: '',
                    tool_calls: undefined,
                    finish_reason: null,
                    reasoning_details: [{
                            type: 'reasoning.summary',
                            summary: event.delta,
                            id: currentReasoningId || undefined
                        }]
                };
            }
            else if (event.type === 'response.output_item.added') {
                if (event.item.type === 'function_call' && isFunctionCall(event.item)) {
                    const outputIndex = event.output_index;
                    const functionCallItem = event.item;
                    currentToolCalls.set(outputIndex, {
                        id: functionCallItem.id || functionCallItem.call_id || '',
                        type: 'function',
                        function: {
                            name: functionCallItem.name,
                            arguments: ''
                        }
                    });
                }
                else if (event.item.type === 'reasoning') {
                    currentReasoningId = event.item.id;
                }
            }
            else if (event.type === 'response.function_call_arguments.delta') {
                const outputIndex = event.output_index;
                const toolCall = currentToolCalls.get(outputIndex);
                if (toolCall) {
                    toolCall.function.arguments += event.delta;
                }
            }
            else if (event.type === 'response.completed') {
                const completedEvent = event;
                if (completedEvent.response?.output) {
                    for (const outputItem of completedEvent.response.output) {
                        if (isReasoningItem(outputItem)) {
                            const reasoningItem = outputItem;
                            if (reasoningItem.encrypted_content) {
                                reasoningDetails.push({
                                    type: 'reasoning.encrypted',
                                    data: reasoningItem.encrypted_content,
                                    id: reasoningItem.id,
                                    format: reasoningItem.format
                                });
                            }
                            if (reasoningItem.summary && reasoningItem.summary.length > 0) {
                                const summaryText = reasoningItem.summary.map(s => s.text).join('\n');
                                reasoningDetails.push({
                                    type: 'reasoning.summary',
                                    summary: summaryText,
                                    id: reasoningItem.id,
                                    format: reasoningItem.format
                                });
                            }
                            if (reasoningItem.content && reasoningItem.content.length > 0) {
                                const contentText = reasoningItem.content.map(c => c.text).join('\n');
                                reasoningDetails.push({
                                    type: 'reasoning.text',
                                    text: contentText,
                                    id: reasoningItem.id,
                                    format: reasoningItem.format
                                });
                            }
                        }
                        // Update tool call arguments from completed response
                        if (isFunctionCall(outputItem)) {
                            const funcCall = outputItem;
                            for (const [, toolCall] of currentToolCalls) {
                                if (toolCall.id === funcCall.id || toolCall.id === funcCall.call_id) {
                                    if (funcCall.arguments) {
                                        toolCall.function.arguments = funcCall.arguments;
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
                // Yield all completed tool calls
                for (const [, toolCall] of currentToolCalls) {
                    yield {
                        content: '',
                        tool_calls: [toolCall],
                        finish_reason: null,
                        reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined
                    };
                }
                yield {
                    content: '',
                    tool_calls: undefined,
                    finish_reason: 'stop',
                    reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined
                };
            }
            else if (event.type === 'error') {
                throw new Error(event.message || 'Unknown error');
            }
        }
    }
    /**
     * Non-streaming chat completion
     */
    async chat(options) {
        const input = [];
        for (const msg of options.messages) {
            if (msg.role === 'tool') {
                input.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id || '',
                    output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
                });
            }
            else {
                const content = getStringContent(msg);
                const role = msg.role === 'system' ? 'system'
                    : msg.role === 'user' ? 'user'
                        : msg.role === 'assistant' ? 'assistant'
                            : 'developer';
                input.push(buildEasyInputMessage(role, content));
                if (msg.role === 'assistant' && msg.reasoning_details && msg.reasoning_details.length > 0) {
                    for (const detail of msg.reasoning_details) {
                        const reasoningItem = {
                            id: detail.id || `reasoning_${Date.now()}`,
                            type: 'reasoning',
                            summary: []
                        };
                        if (detail.type === 'reasoning.summary' && detail.summary) {
                            reasoningItem.summary = [{ type: 'summary_text', text: detail.summary }];
                        }
                        if (detail.type === 'reasoning.text' && detail.text) {
                            reasoningItem.content = [
                                { type: 'reasoning_text', text: detail.text }
                            ];
                        }
                        if (detail.type === 'reasoning.encrypted' && detail.data) {
                            reasoningItem.encrypted_content = detail.data;
                        }
                        input.push(reasoningItem);
                    }
                }
                else if (msg.role === 'assistant' && msg.reasoning) {
                    const reasoningItem = {
                        id: msg.reasoning_id || `reasoning_${Date.now()}`,
                        type: 'reasoning',
                        summary: [{
                                type: 'summary_text',
                                text: msg.reasoning
                            }]
                    };
                    input.push(reasoningItem);
                }
                if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
                    for (const tc of msg.tool_calls) {
                        const functionCallItem = {
                            type: 'function_call',
                            call_id: tc.id,
                            name: tc.function.name,
                            arguments: tc.function.arguments
                        };
                        input.push(functionCallItem);
                    }
                }
            }
        }
        const tools = options.tools?.map(tool => ({
            type: 'function',
            name: tool.function.name,
            description: tool.function.description || undefined,
            parameters: tool.function.parameters,
            strict: null
        }));
        const params = {
            model: options.model,
            input,
            temperature: options.temperature ?? null,
            tools: tools,
            tool_choice: options.tool_choice,
            stream: false
        };
        const response = await this.client.responses.create(params, {
            signal: options.signal
        });
        let content = '';
        let toolCalls = [];
        let reasoningDetails = [];
        for (const outputItem of response.output) {
            if (outputItem.type === 'message') {
                for (const contentItem of outputItem.content) {
                    if (contentItem.type === 'output_text') {
                        content += contentItem.text;
                    }
                }
            }
            else if (outputItem.type === 'function_call' && isFunctionCall(outputItem)) {
                const functionCallItem = outputItem;
                toolCalls.push({
                    id: functionCallItem.id || functionCallItem.call_id || '',
                    type: 'function',
                    function: {
                        name: functionCallItem.name,
                        arguments: functionCallItem.arguments
                    }
                });
            }
            else if (outputItem.type === 'reasoning') {
                if (isReasoningItem(outputItem)) {
                    const reasoningItem = outputItem;
                    if (reasoningItem.encrypted_content) {
                        reasoningDetails.push({
                            type: 'reasoning.encrypted',
                            data: reasoningItem.encrypted_content,
                            id: reasoningItem.id,
                            format: reasoningItem.format
                        });
                    }
                    if (reasoningItem.summary && reasoningItem.summary.length > 0) {
                        const summaryText = reasoningItem.summary.map(s => s.text).join('\n');
                        reasoningDetails.push({
                            type: 'reasoning.summary',
                            summary: summaryText,
                            id: reasoningItem.id,
                            format: reasoningItem.format
                        });
                    }
                    if (reasoningItem.content && reasoningItem.content.length > 0) {
                        const contentText = reasoningItem.content.map(c => c.text).join('\n');
                        reasoningDetails.push({
                            type: 'reasoning.text',
                            text: contentText,
                            id: reasoningItem.id,
                            format: reasoningItem.format
                        });
                    }
                }
            }
        }
        return {
            content,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
            reasoning_details: reasoningDetails.length > 0 ? reasoningDetails : undefined,
            finish_reason: response.status === 'completed' ? 'stop' : null,
            usage: response.usage ? {
                prompt_tokens: response.usage.input_tokens,
                completion_tokens: response.usage.output_tokens,
                total_tokens: response.usage.total_tokens
            } : undefined
        };
    }
}
//# sourceMappingURL=client.js.map