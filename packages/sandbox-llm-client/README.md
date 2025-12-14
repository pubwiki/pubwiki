# @pubwiki/sandbox-llm-client

WikiRAG client library for sandbox environments. This library provides a convenient interface for user game code to interact with the AI game engine powered by wiki-rag-lab.

## Features

- **Multi-turn Chat**: Chat with history management
- **Streaming Responses**: Real-time streaming chat
- **Entity Management**: Query and manage game entities
- **Reactive Data**: Automatic synchronization of entity state
- **Lua Execution**: Execute Lua code for game logic
- **Type-safe**: Full TypeScript support

## Installation

```bash
npm install @pubwiki/sandbox-llm-client
```

## Usage

```typescript
import { initWikiRAG } from '@pubwiki/sandbox-llm-client'

// Provider is injected by sandbox-client
const provider = (window as any).__wikiRAGProvider
const rag = initWikiRAG(provider)

// Chat with history
const result = await rag.chat("Tell me about the world", "session_1")
console.log(result.text)

// Streaming chat
for await (const chunk of rag.chatStream("Continue the story", "session_1")) {
  if (chunk.type === 'stream_chunk') {
    process(chunk.chunk)
  }
}

// Query entities
const result = await rag.query("Who is the protagonist?")

// Access reactive entity data
await rag.reactive.entities.allsync()
const protagonist = rag.reactive.entities.get("2")
console.log(protagonist.components.Identity.properties.true_name)

// Watch for changes
rag.reactive.entities.watch((key, oldValue, newValue) => {
  console.log(`${key} changed from ${oldValue} to ${newValue}`)
})
```

## API Reference

### WikiRAGClient

The main client class for interacting with WikiRAG.

#### Methods

- `chat(message, historyId?, preset?, options?)` - Multi-turn chat with history
- `chatStream(message, historyId?, preset?, options?)` - Streaming chat
- `query(message, preset?, options?)` - Single query without history
- `getEntityOverview(entityId)` - Get entity overview
- `listEntities()` - List all entities
- `getHistory(historyId)` - Get chat history
- `setHistory(historyId, messages)` - Set chat history
- `clearHistory(historyId)` - Clear chat history
- `executeLua(code)` - Execute Lua code

#### Properties

- `reactive.entities` - Reactive entity access

### ReactiveEntities

Provides reactive access to entity data with automatic synchronization.

#### Methods

- `get(entityId)` - Get reactive proxy for entity
- `allsync()` - Synchronize all entity data
- `watch(callback, filter?)` - Watch for entity changes
- `watchWith(filter, callback)` - Watch with custom filter

## Architecture

This library is part of a three-tier architecture:

1. **Main Site** (chatbot-ui) - Manages WikiApp instance and RDF storage
2. **Sandbox** (sandbox-client) - Provides secure execution environment
3. **User Game Code** - Uses this library to interact with AI engine

Communication flows through MessageChannel/MessagePort for security and isolation.

## License

MIT
