# @pubwiki/svelte-chat

Svelte 5 chat UI components built on `@pubwiki/chat` core library.

## Features

- 🎯 **Svelte 5 Runes** - Modern reactive state management
- 📦 **Block-based Rendering** - Supports markdown, code, tool calls, images, and more
- 🔄 **Streaming Support** - Real-time message streaming
- 🛠️ **Tool Call Display** - Built-in tool call visualization
- 📝 **Reasoning Display** - Chain-of-thought visualization
- 🎨 **Customizable** - Tailwind CSS styling with full customization support

## Installation

```bash
pnpm add @pubwiki/svelte-chat @pubwiki/chat
```

## Usage

```svelte
<script lang="ts">
  import { ChatUI, ChatInput, ChatMessages, Message } from '@pubwiki/svelte-chat'
  import { PubChat, MemoryMessageStore } from '@pubwiki/chat'
  
  const pubchat = new PubChat({
    llm: {
      apiKey: 'your-api-key',
      model: 'gpt-4',
    },
    messageStore: new MemoryMessageStore(),
  })
</script>

<ChatUI {pubchat}>
  <ChatMessages />
  <ChatInput />
</ChatUI>
```

## Components

### ChatUI

Main container component that provides context to child components.

### ChatInput

Input component for sending messages.

### ChatMessages

Message list component with optional virtualization.

### Message

Individual message component.

### BlockRenderer

Core block rendering system supporting:

- `text` - Plain text
- `markdown` - Markdown with syntax highlighting
- `code` - Code blocks with language detection
- `tool_call` - Tool call request display
- `tool_result` - Tool call result display
- `reasoning` - Chain-of-thought reasoning
- `image` - Images
- `table` - Tables
- `list` - Lists
- `html` - Raw HTML
- `custom` - Custom renderers

## Stores

```typescript
import { createChatInputStore, createActiveChatStore } from '@pubwiki/svelte-chat/stores'

// Input state
const inputStore = createChatInputStore()
inputStore.userInput // current input
inputStore.setUserInput('Hello')

// Active chat state
const chatStore = createActiveChatStore()
chatStore.isGenerating // boolean
chatStore.abort() // abort current generation
```

## License

MIT
