# @pubwiki/chat

Chat library with streaming, tool calling, structured output, and message history support.

## Installation

```bash
pnpm add @pubwiki/chat
```

## Quick Start

```typescript
import { PubChat, MemoryMessageStore } from '@pubwiki/chat'

const pubchat = new PubChat({
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'gpt-4o',
  },
  messageStore: new MemoryMessageStore(),
})

// Non-streaming
const { message, historyId } = await pubchat.chat('Hello!')
console.log(message.blocks[0].content)

// Streaming
for await (const event of pubchat.streamChat('Hello!')) {
  if (event.type === 'token') {
    process.stdout.write(event.token)
  }
}
```

## API Modes

The library supports two API modes:

### Responses API (Default)

OpenAI native Responses API with full reasoning token support:

```typescript
const pubchat = new PubChat({
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5',
    // apiMode: 'responses',  // Default, can be omitted
    reasoning: {
      effort: 'medium',
      summary: 'concise'
    }
  },
  messageStore: new MemoryMessageStore(),
})
```

### Chat Completions API

Standard OpenAI Chat Completions API, widely compatible with:
- OpenRouter
- Azure OpenAI
- Ollama
- vLLM
- LocalAI
- Groq, Together.ai, Fireworks, and more

```typescript
const pubchat = new PubChat({
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
    apiMode: 'chat-completions',
  },
  messageStore: new MemoryMessageStore(),
})
```

## Features

### Streaming

```typescript
for await (const event of pubchat.streamChat('Hello!')) {
  switch (event.type) {
    case 'token':
      process.stdout.write(event.token)
      break
    case 'reasoning':
      console.log('[Reasoning]', event.token)
      break
    case 'tool_call':
      console.log(`[Tool] ${event.name}:`, event.args)
      break
    case 'tool_result':
      console.log(`[Result]:`, event.result)
      break
    case 'done':
      console.log('History ID:', event.historyId)
      break
    case 'error':
      console.error('Error:', event.error)
      break
  }
}
```

### Tool Calling

```typescript
import { z } from 'zod'

const pubchat = new PubChat({
  llm: { apiKey: 'sk-xxx', model: 'gpt-4o' },
  messageStore: new MemoryMessageStore(),
  toolCalling: { enabled: true },
})

pubchat.registerTool({
  name: 'get_weather',
  description: 'Get weather for a city',
  schema: z.object({
    city: z.string(),
    unit: z.enum(['celsius', 'fahrenheit']).optional()
  }),
  handler: async ({ city, unit = 'celsius' }) => {
    return { city, temperature: 22, unit }
  }
})

const { message } = await pubchat.chat('What is the weather in Tokyo?')
```

### Structured Output

```typescript
const pubchat = new PubChat({
  llm: {
    apiKey: 'sk-xxx',
    model: 'gpt-4o',
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'PersonInfo',
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            age: { type: 'number' }
          },
          required: ['name', 'age'],
          additionalProperties: false
        },
        strict: true
      }
    }
  },
  messageStore: new MemoryMessageStore(),
})

const { message } = await pubchat.chat('Extract: John is 30 years old.')
const data = JSON.parse(message.blocks[0].content)
// { name: 'John', age: 30 }
```

### VFS Integration

```typescript
pubchat.setVFS(myVfsProvider)

// AI can now use: read_file, write_file, delete_file, list_dir, mkdir, file_exists
const { message } = await pubchat.chat('Create hello.txt with "Hello World"')
```

### OpenRouter / Custom Endpoints

```typescript
const pubchat = new PubChat({
  llm: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-sonnet-4',
  },
  messageStore: new MemoryMessageStore(),
})
```

### System Prompt

```typescript
import { createSystemMessage } from '@pubwiki/chat'

const systemMsg = createSystemMessage('You are a helpful assistant.', null)
const [systemHistoryId] = await pubchat.addConversation([systemMsg])

const { message } = await pubchat.chat('Hello!', systemHistoryId)
```

## API

### PubChatConfig

```typescript
interface PubChatConfig {
  llm: {
    apiKey: string
    model: string
    baseUrl?: string
    temperature?: number
    maxTokens?: number
    organizationId?: string
    responseFormat?: ResponseFormat
  }
  messageStore: MessageStoreProvider
  toolCalling?: {
    enabled: boolean
    maxIterations?: number  // default: 10
  }
  onIterationLimitReached?: (current: number, max: number) => Promise<boolean>
}
```

### ResponseFormat

```typescript
type ResponseFormat =
  | { type: 'json_schema'; json_schema: { name: string; schema: object; strict?: boolean } }
  | { type: 'json_object' }
  | { type: 'text' }
```

### ChatStreamEvent

```typescript
type ChatStreamEvent =
  | { type: 'token'; token: string }
  | { type: 'reasoning'; token: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; result: unknown }
  | { type: 'iteration_limit_reached'; currentIteration: number; maxIterations: number }
  | { type: 'error'; error: Error }
  | { type: 'done'; message: MessageNode; historyId: string }
```

### Methods

```typescript
// Chat
chat(prompt: string, historyId?: string, overrideConfig?: Partial<LLMConfig>): Promise<ChatResult>
streamChat(prompt: string, historyId?: string, overrideConfig?: Partial<LLMConfig>): AsyncGenerator<ChatStreamEvent>

// Conversation
addConversation(messages: MessageNode[], parentId?: string): Promise<string[]>
getConversation(historyId: string): Promise<ConversationSnapshot>
getBranches(messageId: string): Promise<MessageNode[]>
listConversations(): Promise<MessageNode[]>
deleteConversation(historyId: string, deleteAll?: boolean): Promise<void>
abort(): void

// Tools
registerTool(tool: ToolRegistrationParams): void
getToolRegistry(): ToolRegistry

// VFS
setVFS(vfs: Vfs): void
getVFS(): Vfs | undefined
hasVFS(): boolean
clearVFS(): void
```

## License

MIT
