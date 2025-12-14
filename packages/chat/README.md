# @pubwiki/pubchat-core

Core chat library with function calling, streaming, and message history support.

## Features

- 🔄 **Streaming Support**: Full streaming support for chat responses with token-by-token output
- 🛠️ **Function Calling**: Built-in tool/function calling with Zod schema validation
- 📝 **Message History**: Immutable linked list based message history with natural branching support
- 🔌 **Provider Pattern**: Pluggable storage (MessageStoreProvider) and VFS (VFSProvider) providers
- 🧠 **Reasoning Support**: Support for reasoning tokens (Claude, OpenAI o1, Gemini, etc.)
- 🌐 **OpenAI Compatible**: Works with OpenAI, OpenRouter, and any OpenAI-compatible API

## Installation

```bash
pnpm add @pubwiki/pubchat-core
```

## Quick Start

### Basic Chat

```typescript
import { PubChat, MemoryMessageStore } from '@pubwiki/pubchat-core'

const pubchat = new PubChat({
  llm: {
    apiKey: 'sk-xxx',
    model: 'gpt-4o',
  },
  messageStore: new MemoryMessageStore(),
})

// Non-streaming chat
const { message, historyId } = await pubchat.chat('Hello!')
console.log('Response:', message.blocks[0].content)

// Continue conversation
const result = await pubchat.chat('Tell me more', historyId)
```

### Streaming Chat

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
      console.log(`\n[Tool Call] ${event.name}:`, event.args)
      break
    case 'tool_result':
      console.log(`[Tool Result]:`, event.result)
      break
    case 'done':
      console.log('\n--- Done ---')
      console.log('History ID:', event.historyId)
      break
    case 'error':
      console.error('Error:', event.error)
      break
  }
}
```

### With System Prompt

```typescript
import { PubChat, MemoryMessageStore, createSystemMessage } from '@pubwiki/pubchat-core'

const pubchat = new PubChat({
  llm: { apiKey: 'sk-xxx', model: 'gpt-4o' },
  messageStore: new MemoryMessageStore(),
})

// Add system message via addConversation
const systemMsg = createSystemMessage('You are a helpful assistant.', null)
const [systemHistoryId] = await pubchat.addConversation([systemMsg])

// Chat with system context
const { message } = await pubchat.chat('Hello!', systemHistoryId)
```

### With Tool Calling

```typescript
import { z } from 'zod'
import { PubChat, MemoryMessageStore } from '@pubwiki/pubchat-core'

const pubchat = new PubChat({
  llm: { apiKey: 'sk-xxx', model: 'gpt-4o' },
  messageStore: new MemoryMessageStore(),
  toolCalling: {
    enabled: true,
    maxIterations: 10,
  },
})

// Register a tool with Zod schema
pubchat.registerTool({
  name: 'get_weather',
  description: 'Get weather for a city',
  schema: z.object({
    city: z.string().describe('City name'),
    unit: z.enum(['celsius', 'fahrenheit']).optional()
  }),
  handler: async (args) => {
    const { city, unit = 'celsius' } = args as { city: string; unit?: string }
    // Your implementation
    return { city, temperature: 22, unit }
  }
})

const { message } = await pubchat.chat('What is the weather in Tokyo?')
```

### With VFS (Virtual File System)

```typescript
// Set VFS provider (automatically registers file tools)
pubchat.setVFS(myVFSProvider)

// AI can now use file operations:
// - read_file, write_file, delete_file
// - list_dir, mkdir
// - file_exists
const { message } = await pubchat.chat('Create a file called hello.txt with "Hello World"')
```

### With OpenRouter

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

---

## API Reference

### PubChat

Main class implementing the `ChatProvider` interface.

#### Constructor

```typescript
new PubChat(config: PubChatConfig)
```

#### PubChatConfig

```typescript
interface PubChatConfig {
  /** LLM configuration */
  llm: {
    apiKey: string
    baseUrl?: string      // Default: OpenAI API
    model: string
    temperature?: number
    maxTokens?: number
    organizationId?: string
  }
  
  /** Message store provider */
  messageStore: MessageStoreProvider
  
  /** Tool calling configuration */
  toolCalling?: {
    enabled: boolean
    maxIterations?: number  // Default: 10
  }
  
  /** Called when tool iterations reach limit */
  onIterationLimitReached?: (current: number, max: number) => Promise<boolean>
}
```

#### Methods

##### Chat Methods

```typescript
// Non-streaming chat
chat(prompt: string, historyId?: string): Promise<ChatResult>

// Streaming chat
streamChat(prompt: string, historyId?: string): AsyncGenerator<ChatStreamEvent>
```

##### Conversation Management

```typescript
// Add messages (auto-chains parentId)
addConversation(messages: MessageNode[], parentId?: string): Promise<string[]>

// Get conversation snapshot
getConversation(historyId: string): Promise<ConversationSnapshot>

// Get message branches (children)
getBranches(messageId: string): Promise<MessageNode[]>

// List all conversations
listConversations(): Promise<MessageNode[]>

// Delete conversation
deleteConversation(historyId: string, deleteAll?: boolean): Promise<void>

// Cancel current generation
abort(): void
```

##### Tool/Function Calling

```typescript
// Register a tool
registerTool(tool: ToolRegistrationParams): void

// Get tool registry
getToolRegistry(): ToolRegistry
```

##### VFS Integration

```typescript
// Set VFS provider (auto-registers VFS tools)
setVFS(vfs: VFSProvider): void

// Get VFS provider
getVFS(): VFSProvider | undefined

// Check if VFS is available
hasVFS(): boolean
```

---

## Type Definitions

### ChatResult

```typescript
interface ChatResult {
  message: MessageNode
  historyId: string
}
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

### MessageNode

Immutable linked list node for message history.

```typescript
interface MessageNode {
  id: string
  parentId: string | null
  role: MessageRole
  blocks: MessageBlock[]
  timestamp: number
  model?: string
  metadata?: {
    reasoning?: string
    reasoning_details?: ReasoningDetail[]
    [key: string]: unknown
  }
}

type MessageRole = 'user' | 'assistant' | 'system'
```

### MessageBlock

Atomic content unit within a message.

```typescript
interface MessageBlock {
  id: string
  type: MessageBlockType
  content: string
  metadata?: Record<string, unknown>
  
  // Tool call fields
  toolCallId?: string
  toolName?: string
  toolArgs?: unknown
  toolStatus?: ToolCallStatus
}

type MessageBlockType = 
  | 'text'        // Plain text
  | 'markdown'    // Markdown content
  | 'code'        // Code block
  | 'tool_call'   // Tool call request
  | 'tool_result' // Tool call result
  | 'image'       // Image (reserved)
  | 'reasoning'   // Reasoning content

type ToolCallStatus = 'pending' | 'running' | 'completed' | 'error'
```

### ConversationSnapshot

```typescript
interface ConversationSnapshot {
  id: string
  messages: MessageNode[]
  rootId: string
  leafId: string
}
```

### ToolRegistrationParams

```typescript
interface ToolRegistrationParams {
  name: string
  description: string
  schema: z.ZodTypeAny
  handler: (args: unknown) => Promise<unknown>
}
```

---

## Provider Interfaces

### MessageStoreProvider

Interface for message persistence.

```typescript
interface MessageStoreProvider {
  save(node: MessageNode): Promise<void>
  saveBatch(nodes: MessageNode[]): Promise<void>
  get(id: string): Promise<MessageNode | null>
  getChildren(parentId: string): Promise<MessageNode[]>
  getPath(leafId: string): Promise<MessageNode[]>
  delete(id: string, deleteDescendants?: boolean): Promise<void>
  listRoots(): Promise<MessageNode[]>
}
```

### VFSProvider

Interface for virtual file system operations.

```typescript
interface VFSProvider {
  // File operations
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  deleteFile(path: string): Promise<void>
  
  // Directory operations
  listDir(path: string): Promise<VFSDirEntry[]>
  mkdir(path: string): Promise<void>
  rmdir(path: string, recursive?: boolean): Promise<void>
  
  // Utilities
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<VFSStat>
}

interface VFSDirEntry {
  name: string
  isDirectory: boolean
}

interface VFSStat {
  size: number
  isFile: boolean
  isDirectory: boolean
}
```

---

## Built-in Implementations

### MemoryMessageStore

In-memory message store for testing or simple use cases.

```typescript
import { MemoryMessageStore } from '@pubwiki/pubchat-core'

const store = new MemoryMessageStore()

// Additional methods
store.clear()           // Clear all data
store.size              // Get message count
store.exportData()      // Export for persistence
store.importData(data)  // Import from persistence
```

---

## Utility Functions

### Message Creators

```typescript
import { 
  createUserMessage,
  createSystemMessage,
  createAssistantMessage 
} from '@pubwiki/pubchat-core'

const userMsg = createUserMessage('Hello', parentId)
const systemMsg = createSystemMessage('You are helpful', null)
const assistantMsg = createAssistantMessage('Hi there!', parentId, 'gpt-4')
```

### Block Creators

```typescript
import {
  createTextBlock,
  createMarkdownBlock,
  createToolCallBlock,
  createToolResultBlock,
  createReasoningBlock,
  generateBlockId,
  generateMessageId
} from '@pubwiki/pubchat-core'
```

### Content Extractors

```typescript
import { blocksToContent, blocksToCode } from '@pubwiki/pubchat-core'

// Get text/markdown content
const text = blocksToContent(message.blocks)

// Get code blocks
const code = blocksToCode(message.blocks)
```

---

## ChatProvider Interface

The `ChatProvider` interface defines the contract that `PubChat` implements. You can create your own implementations.

```typescript
interface ChatProvider {
  // Chat
  chat(prompt: string, historyId?: string): Promise<ChatResult>
  streamChat(prompt: string, historyId?: string): AsyncGenerator<ChatStreamEvent>
  
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
  setVFS(vfs: VFSProvider): void
  getVFS(): VFSProvider | undefined
  hasVFS(): boolean
}
```

---

## License

MIT
