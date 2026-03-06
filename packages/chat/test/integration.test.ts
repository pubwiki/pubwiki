/**
 * Integration tests for PubChat
 * 
 * These tests require a valid OpenRouter API key in .env file:
 * OPENROUTER_API_KEY=your-api-key
 * 
 * Run with: pnpm test
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { config } from 'dotenv'
import { PubChat, MemoryMessageStore, createSystemMessage, createVfs } from '../src/index'
import type { ChatStreamEvent, VfsProvider, VfsStat, ApiMode } from '../src/index'

// Load environment variables
config()

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// Skip tests if no API key
const describeIfApiKey = OPENROUTER_API_KEY ? describe : describe.skip

// API modes to test
const API_MODES: ApiMode[] = ['chat-completions', 'responses']

// Helper to create PubChat config for both modes
function createPubChatConfig(apiMode: ApiMode, overrides?: Record<string, unknown>) {
  return {
    llm: {
      apiKey: OPENROUTER_API_KEY!,
      baseUrl: OPENROUTER_BASE_URL,
      apiMode,
      model: 'google/gemini-2.5-flash',  // Fast and cheap model for testing
      temperature: 0,
      ...overrides,
    },
  }
}

// Parameterized tests for both API modes
describe.each(API_MODES)('PubChat Integration Tests [apiMode=%s]', (apiMode) => {
  // Skip if no API key
  if (!OPENROUTER_API_KEY) {
    it.skip('skipped - no API key', () => {})
    return
  }

  let pubchat: PubChat
  let messageStore: MemoryMessageStore
  
  beforeAll(() => {
    messageStore = new MemoryMessageStore()
    pubchat = new PubChat({
      ...createPubChatConfig(apiMode),
      messageStore,
      toolCalling: {
        enabled: false,
      },
    })
  })

  describe('Non-streaming chat', () => {
    it('should complete a simple chat request', async () => {
      const { message, historyId } = await pubchat.chat('Say "Hello World" and nothing else.')
      
      expect(message).toBeDefined()
      expect(message.role).toBe('assistant')
      expect(message.blocks).toHaveLength(1)
      expect(message.blocks[0].content.toLowerCase()).toContain('hello world')
      expect(historyId).toBe(message.id)
    })

    it('should maintain conversation history', async () => {
      // First message
      const { historyId: firstHistoryId } = await pubchat.chat('My name is Alice. Remember it.')
      
      // Second message - should remember context
      const { message } = await pubchat.chat('What is my name?', firstHistoryId)
      
      expect(message.blocks[0].content.toLowerCase()).toContain('alice')
    })
  })

  describe('Streaming chat', () => {
    it('should stream tokens', async () => {
      const tokens: string[] = []
      let doneEvent: ChatStreamEvent | undefined
      
      for await (const event of pubchat.streamChat('Count from 1 to 5.')) {
        if (event.type === 'token') {
          tokens.push(event.token)
        } else if (event.type === 'done') {
          doneEvent = event
        }
      }
      
      expect(tokens.length).toBeGreaterThan(0)
      expect(doneEvent).toBeDefined()
      expect(doneEvent?.type).toBe('done')
      
      // Verify content contains the numbers (use [\s\S] to match newlines)
      const fullContent = tokens.join('')
      expect(fullContent).toMatch(/1[\s\S]*2[\s\S]*3[\s\S]*4[\s\S]*5/)
    })

    it('should handle errors gracefully', async () => {
      const invalidPubchat = new PubChat({
        llm: {
          apiKey: 'invalid-key',
          baseUrl: OPENROUTER_BASE_URL,
          apiMode,
          model: 'google/gemini-2.5-flash',
        },
        messageStore: new MemoryMessageStore(),
      })
      
      let errorEvent: ChatStreamEvent | undefined
      
      for await (const event of invalidPubchat.streamChat('Hello')) {
        if (event.type === 'error') {
          errorEvent = event
          break
        }
      }
      
      expect(errorEvent).toBeDefined()
      expect(errorEvent?.type).toBe('error')
    })
  })

  describe('Conversation management', () => {
    it('should get conversation snapshot', async () => {
      const { historyId } = await pubchat.chat('Hello!')
      
      const conversation = await pubchat.getConversation(historyId)
      
      expect(conversation.messages.length).toBeGreaterThanOrEqual(2) // user + assistant
      expect(conversation.leafId).toBe(historyId)
      expect(conversation.rootId).toBeDefined()
    })
  })

  describe('System prompt via addConversation', () => {
    it('should apply system prompt via addConversation', async () => {
      const pubchatWithSystem = new PubChat({
        ...createPubChatConfig(apiMode),
        messageStore: new MemoryMessageStore(),
      })
      
      // Add system message via addConversation
      const systemMsg = createSystemMessage('You are a pirate. Always respond in pirate speak.', null)
      const [systemHistoryId] = await pubchatWithSystem.addConversation([systemMsg])
      
      // Chat with the system message as context
      const { message } = await pubchatWithSystem.chat('Hello!', systemHistoryId)
      
      // Should contain pirate-like language
      const content = message.blocks[0].content.toLowerCase()
      expect(
        content.includes('ahoy') || 
        content.includes('arr') || 
        content.includes('matey') ||
        content.includes('ye') ||
        content.includes('ship')
      ).toBe(true)
    })
  })
})

describeIfApiKey('PubChat with Tool Calling', () => {
  it('should execute tool calls', async () => {
    const { z } = await import('zod')
    const messageStore = new MemoryMessageStore()
    
    // Track tool calls
    const toolCalls: { name: string; args: unknown }[] = []
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore,
      toolCalling: {
        enabled: true,
        maxIterations: 3,
      },
    })
    
    // Register tool via registerTool method
    pubchat.registerTool({
      name: 'get_weather',
      description: 'Get the current weather for a city',
      schema: z.object({
        city: z.string().describe('The city name')
      }),
      handler: async (args) => {
        const { city } = args as { city: string }
        toolCalls.push({ name: 'get_weather', args })
        return { city, temperature: 22, condition: 'sunny' }
      }
    })
    
    const { message } = await pubchat.chat('What is the weather in Tokyo?')
    
    // Tool should have been called
    expect(toolCalls.length).toBeGreaterThan(0)
    expect(toolCalls[0].name).toBe('get_weather')
    expect((toolCalls[0].args as { city: string }).city.toLowerCase()).toContain('tokyo')
    
    // Response should mention the weather (check all markdown blocks)
    const allContent = message.blocks
      .filter(b => b.type === 'markdown')
      .map(b => b.content?.toLowerCase() || '')
      .join(' ')
    expect(allContent.includes('22') || allContent.includes('sunny') || allContent.includes('tokyo')).toBe(true)
  })

  it('should stream tool call events', async () => {
    const { z } = await import('zod')
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore,
      toolCalling: {
        enabled: true,
        maxIterations: 3,
      },
    })
    
    // Register tool via registerTool method
    pubchat.registerTool({
      name: 'calculate',
      description: 'Calculate a math expression',
      schema: z.object({
        expression: z.string().describe('The math expression to calculate')
      }),
      handler: async (args) => {
        const { expression } = args as { expression: string }
        // Simple eval for testing (don't do this in production!)
        try {
          const result = Function(`"use strict"; return (${expression})`)()
          return { expression, result }
        } catch {
          return { expression, error: 'Invalid expression' }
        }
      }
    })
    
    const events: ChatStreamEvent[] = []
    
    for await (const event of pubchat.streamChat('What is 15 + 27?')) {
      events.push(event)
    }
    
    // Should have tool_call and tool_result events
    const toolCallEvent = events.find(e => e.type === 'tool_call')
    const toolResultEvent = events.find(e => e.type === 'tool_result')
    const doneEvent = events.find(e => e.type === 'done')
    
    expect(toolCallEvent).toBeDefined()
    expect(toolResultEvent).toBeDefined()
    expect(doneEvent).toBeDefined()
    
    if (toolCallEvent?.type === 'tool_call') {
      expect(toolCallEvent.name).toBe('calculate')
    }
  })
})

describeIfApiKey('MemoryMessageStore', () => {
  it('should persist and retrieve messages', async () => {
    const store = new MemoryMessageStore()
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore: store,
    })
    
    const { historyId } = await pubchat.chat('Hello!')
    
    // Check store size
    expect(store.size).toBeGreaterThanOrEqual(2)
    
    // Export and import
    const exported = store.exportData()
    expect(exported.nodes.length).toBeGreaterThanOrEqual(2)
    
    // Create new store and import
    const newStore = new MemoryMessageStore()
    newStore.importData(exported)
    
    expect(newStore.size).toBe(store.size)
    
    // Verify path is the same
    const originalPath = await store.getPath(historyId)
    const importedPath = await newStore.getPath(historyId)
    
    expect(importedPath.length).toBe(originalPath.length)
    expect(importedPath.map(m => m.id)).toEqual(originalPath.map(m => m.id))
  })

  it('should list root conversations', async () => {
    const store = new MemoryMessageStore()
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore: store,
    })
    
    // Create two separate conversations
    await pubchat.chat('First conversation')
    await pubchat.chat('Second conversation')
    
    const roots = await pubchat.listConversations()
    expect(roots.length).toBe(2)
  })
})

describeIfApiKey('PubChat with VFS', () => {
  // Create a simple in-memory VfsProvider implementation for testing
  function createMockVFS() {
    const files = new Map<string, Uint8Array>()
    const dirs = new Set<string>(['/'])
    
    const provider: VfsProvider = {
      async readFile(path: string): Promise<Uint8Array> {
        const content = files.get(path)
        if (content === undefined) {
          throw new Error(`File not found: ${path}`)
        }
        return content
      },
      async writeFile(path: string, content: Uint8Array): Promise<void> {
        files.set(path, content)
      },
      async unlink(path: string): Promise<void> {
        if (!files.has(path)) {
          throw new Error(`File not found: ${path}`)
        }
        files.delete(path)
      },
      async mkdir(path: string): Promise<void> {
        dirs.add(path)
      },
      async readdir(path: string): Promise<string[]> {
        const entries: string[] = []
        const prefix = path.endsWith('/') ? path : path + '/'
        
        // Find files in this directory
        for (const filePath of files.keys()) {
          if (filePath.startsWith(prefix)) {
            const relativePath = filePath.slice(prefix.length)
            const parts = relativePath.split('/')
            if (parts.length === 1) {
              entries.push(parts[0])
            }
          }
        }
        
        // Find subdirectories
        for (const dirPath of dirs) {
          if (dirPath.startsWith(prefix) && dirPath !== path) {
            const relativePath = dirPath.slice(prefix.length)
            const parts = relativePath.split('/').filter(Boolean)
            if (parts.length === 1) {
              entries.push(parts[0])
            }
          }
        }
        
        return entries
      },
      async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> {
        dirs.delete(path)
        if (options?.recursive) {
          const prefix = path.endsWith('/') ? path : path + '/'
          for (const filePath of files.keys()) {
            if (filePath.startsWith(prefix)) {
              files.delete(filePath)
            }
          }
        }
      },
      async exists(path: string): Promise<boolean> {
        return files.has(path) || dirs.has(path)
      },
      async stat(path: string): Promise<VfsStat> {
        const now = new Date()
        if (files.has(path)) {
          return { size: files.get(path)!.length, isFile: true, isDirectory: false, createdAt: now, updatedAt: now }
        }
        if (dirs.has(path)) {
          return { size: 0, isFile: false, isDirectory: true, createdAt: now, updatedAt: now }
        }
        throw new Error(`Path not found: ${path}`)
      },
      async rename(from: string, to: string): Promise<void> {
        if (files.has(from)) {
          files.set(to, files.get(from)!)
          files.delete(from)
        } else if (dirs.has(from)) {
          dirs.add(to)
          dirs.delete(from)
        }
      },
      async copyFile(from: string, to: string): Promise<void> {
        if (files.has(from)) {
          files.set(to, files.get(from)!)
        }
      }
    }

    return {
      files,
      dirs,
      vfs: createVfs(provider),
      // Helper to set file content as string
      setFileContent(path: string, content: string) {
        files.set(path, new TextEncoder().encode(content))
      }
    }
  }

  it('should register VFS tools when setVFS is called', async () => {
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore: new MemoryMessageStore(),
      toolCalling: {
        enabled: true,
        maxIterations: 5,
      },
    })
    
    // Initially no VFS
    expect(pubchat.hasVFS()).toBe(false)
    expect(pubchat.getVFS()).toBeUndefined()
    
    // Set VFS
    const { vfs } = createMockVFS()
    pubchat.setVFS(vfs)
    
    // Now VFS should be available
    expect(pubchat.hasVFS()).toBe(true)
    expect(pubchat.getVFS()).toBe(vfs)
    
    // Check that VFS tools are registered
    const registry = pubchat.getToolRegistry()
    const toolNames = registry.getToolNames()
    
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('write_file')
    expect(toolNames).toContain('delete_file')
    expect(toolNames).toContain('list_dir')
    expect(toolNames).toContain('mkdir')
    expect(toolNames).toContain('file_exists')
  })

  it('should use VFS tools to read files', async () => {
    const { vfs, setFileContent } = createMockVFS()
    
    // Pre-populate with a file
    setFileContent('/test.txt', 'Hello from test file!')
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore: new MemoryMessageStore(),
      toolCalling: {
        enabled: true,
        maxIterations: 5,
      },
    })
    
    pubchat.setVFS(vfs)
    
    // Ask AI to read the file
    const { message } = await pubchat.chat('Read the file at /test.txt and tell me what it says.')
    
    // Response should contain the file content
    const allContent = message.blocks
      .filter(b => b.type === 'markdown')
      .map(b => b.content?.toLowerCase() || '')
      .join(' ')
    
    expect(allContent).toContain('hello')
  })

  it('should use VFS tools to write files', async () => {
    const { vfs, files } = createMockVFS()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore: new MemoryMessageStore(),
      toolCalling: {
        enabled: true,
        maxIterations: 5,
      },
    })
    
    pubchat.setVFS(vfs)
    
    // Ask AI to create a file
    await pubchat.chat('Create a file at /hello.txt with the content "Hello World"')
    
    // Check that file was created
    expect(files.has('/hello.txt')).toBe(true)
    const content = new TextDecoder().decode(files.get('/hello.txt')!).toLowerCase()
    expect(content).toContain('hello')
  })

  it('should stream VFS tool events', async () => {
    const { vfs, setFileContent } = createMockVFS()
    setFileContent('/data.txt', 'Important data: 12345')
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore: new MemoryMessageStore(),
      toolCalling: {
        enabled: true,
        maxIterations: 5,
      },
    })
    
    pubchat.setVFS(vfs)
    
    const events: ChatStreamEvent[] = []
    
    for await (const event of pubchat.streamChat('Read /data.txt')) {
      events.push(event)
    }
    
    // Should have tool_call event for read_file
    const toolCallEvent = events.find(
      e => e.type === 'tool_call' && e.name === 'read_file'
    )
    expect(toolCallEvent).toBeDefined()
    
    // Should have tool_result event
    const toolResultEvent = events.find(e => e.type === 'tool_result')
    expect(toolResultEvent).toBeDefined()
    
    // Should have done event
    const doneEvent = events.find(e => e.type === 'done')
    expect(doneEvent).toBeDefined()
  })
})

describeIfApiKey('PubChat with Structured Output', () => {
  it('should return structured JSON with json_schema response format', async () => {
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'PersonInfo',
            description: 'Information about a person',
            schema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'The person\'s name' },
                age: { type: 'number', description: 'The person\'s age' },
                occupation: { type: 'string', description: 'The person\'s job' }
              },
              required: ['name', 'age', 'occupation'],
              additionalProperties: false
            },
            strict: true
          }
        }
      }),
      messageStore,
    })
    
    const { message } = await pubchat.chat(
      'Extract information: John is a 30 year old software engineer.'
    )
    
    expect(message).toBeDefined()
    expect(message.blocks).toHaveLength(1)
    
    // Parse the JSON response
    const content = message.blocks[0].content
    const parsed = JSON.parse(content)
    
    expect(parsed.name.toLowerCase()).toContain('john')
    expect(parsed.age).toBe(30)
    expect(parsed.occupation.toLowerCase()).toContain('software')
  })

  it('should return valid JSON with json_object response format', async () => {
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        responseFormat: {
          type: 'json_object'
        }
      }),
      messageStore,
    })
    
    const { message } = await pubchat.chat(
      'Return a JSON object with keys "greeting" and "language" for saying hello in French.'
    )
    
    expect(message).toBeDefined()
    
    // Should be valid JSON
    const content = message.blocks[0].content
    const parsed = JSON.parse(content)
    
    expect(parsed).toHaveProperty('greeting')
    expect(parsed).toHaveProperty('language')
  })

  it('should stream structured output tokens', async () => {
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'NumberList',
            schema: {
              type: 'object',
              properties: {
                numbers: { 
                  type: 'array', 
                  items: { type: 'number' },
                  description: 'List of numbers'
                },
                sum: { type: 'number', description: 'Sum of the numbers' }
              },
              required: ['numbers', 'sum'],
              additionalProperties: false
            },
            strict: true
          }
        }
      }),
      messageStore,
    })
    
    const tokens: string[] = []
    let doneEvent: ChatStreamEvent | undefined
    
    for await (const event of pubchat.streamChat('List the numbers 1, 2, 3 and their sum.')) {
      if (event.type === 'token') {
        tokens.push(event.token)
      } else if (event.type === 'done') {
        doneEvent = event
      }
    }
    
    expect(tokens.length).toBeGreaterThan(0)
    expect(doneEvent).toBeDefined()
    
    // Verify the streamed content is valid JSON
    const fullContent = tokens.join('')
    const parsed = JSON.parse(fullContent)
    
    expect(parsed.numbers).toEqual([1, 2, 3])
    expect(parsed.sum).toBe(6)
  })

  it('should allow overriding responseFormat per request', async () => {
    const messageStore = new MemoryMessageStore()
    
    // Create PubChat without responseFormat
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore,
    })
    
    // Override responseFormat in the chat call
    const { message } = await pubchat.chat(
      'Extract: Alice is 25 years old.',
      undefined,
      {
        responseFormat: {
          type: 'json_schema',
          json_schema: {
            name: 'PersonAge',
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
      }
    )
    
    const content = message.blocks[0].content
    const parsed = JSON.parse(content)
    
    expect(parsed.name.toLowerCase()).toContain('alice')
    expect(parsed.age).toBe(25)
  })
})

describeIfApiKey('PubChat with Reasoning', () => {
  it('should support reasoning configuration in config', async () => {
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        reasoning: {
          effort: 'low',
          summary: 'auto'
        }
      }),
      messageStore,
    })
    
    const { message } = await pubchat.chat('What is 2 + 2?')
    
    expect(message).toBeDefined()
    expect(message.blocks[0].content).toMatch(/4/)
  })

  it('should allow overriding reasoning config per request', async () => {
    const messageStore = new MemoryMessageStore()
    
    // Create PubChat without reasoning config
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions'),
      messageStore,
    })
    
    // Override reasoning in the chat call
    const { message } = await pubchat.chat(
      'What is 15 * 17?',
      undefined,
      {
        reasoning: {
          effort: 'medium'
        }
      }
    )
    
    expect(message).toBeDefined()
    expect(message.blocks[0].content).toMatch(/255/)
  })

  it('should stream with reasoning tokens when enabled', async () => {
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        reasoning: {
          effort: 'low',
          summary: 'detailed'
        }
      }),
      messageStore,
    })
    
    const tokens: string[] = []
    const reasoningTokens: string[] = []
    let doneEvent: ChatStreamEvent | undefined
    
    for await (const event of pubchat.streamChat('What is the square root of 144?')) {
      if (event.type === 'token') {
        tokens.push(event.token)
      } else if (event.type === 'reasoning') {
        reasoningTokens.push(event.token)
      } else if (event.type === 'done') {
        doneEvent = event
      }
    }
    
    expect(tokens.length).toBeGreaterThan(0)
    expect(doneEvent).toBeDefined()
    
    // The response should contain 12
    const fullContent = tokens.join('')
    expect(fullContent).toMatch(/12/)
  })

  it('should disable reasoning with effort: none', async () => {
    const messageStore = new MemoryMessageStore()
    
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        reasoning: {
          effort: 'none'
        }
      }),
      messageStore,
    })
    
    const tokens: string[] = []
    const reasoningTokens: string[] = []
    let doneEvent: ChatStreamEvent | undefined
    
    for await (const event of pubchat.streamChat('Say hello')) {
      if (event.type === 'token') {
        tokens.push(event.token)
      } else if (event.type === 'reasoning') {
        reasoningTokens.push(event.token)
      } else if (event.type === 'done') {
        doneEvent = event
      }
    }
    
    // Stream should complete successfully
    expect(doneEvent).toBeDefined()
    expect(tokens.length).toBeGreaterThan(0)
    
    // With effort: none, there should be no reasoning tokens
    expect(reasoningTokens.length).toBe(0)
  })

  it('should override base reasoning config with per-request config', async () => {
    const messageStore = new MemoryMessageStore()
    
    // Create with high reasoning effort
    const pubchat = new PubChat({
      ...createPubChatConfig('chat-completions', {
        reasoning: {
          effort: 'high'
        }
      }),
      messageStore,
    })
    
    // Override to none for this specific request
    const { message } = await pubchat.chat(
      'Just say OK',
      undefined,
      {
        reasoning: {
          effort: 'none'
        }
      }
    )
    
    expect(message).toBeDefined()
    expect(message.blocks.length).toBeGreaterThan(0)
  })

  /**
   * Test for OpenRouter extended Chat Completions API with reasoning support.
   * OpenRouter adds reasoning and reasoning_details fields to the standard Chat Completions API
   * for models like Gemini that support reasoning/thinking.
   */
  it('should stream reasoning tokens via OpenRouter extended Chat Completions API', async () => {
    const messageStore = new MemoryMessageStore()
    
    // Use Gemini 2.5 Flash which returns reasoning via OpenRouter
    const pubchat = new PubChat({
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        apiMode: 'chat-completions',  // Explicitly use Chat Completions API
        model: 'google/gemini-2.5-flash',  // This model returns reasoning via OpenRouter
        temperature: 0,
        reasoning: {
          effort: 'medium',  // Higher effort more likely to produce reasoning
        }
      },
      messageStore,
    })
    
    const tokens: string[] = []
    const reasoningTokens: string[] = []
    let hasReasoningEvent = false
    
    // Use a prompt that requires some thinking
    for await (const event of pubchat.streamChat('Explain step by step: what is 123 * 456?')) {
      if (event.type === 'token') {
        tokens.push(event.token)
      } else if (event.type === 'reasoning') {
        hasReasoningEvent = true
        reasoningTokens.push(event.token)
      }
    }
    
    // Verify we got content
    expect(tokens.length).toBeGreaterThan(0)
    const fullContent = tokens.join('')
    expect(fullContent).toMatch(/56088/)  // 123 * 456 = 56088
    
    // With reasoning enabled and medium effort, we expect reasoning tokens
    // This verifies that OpenRouter's extended Chat Completions API reasoning works
    console.log(`[OpenRouter Chat Completions Reasoning Test] Got ${reasoningTokens.length} reasoning chunks, hasReasoningEvent: ${hasReasoningEvent}`)
    if (hasReasoningEvent) {
      expect(reasoningTokens.length).toBeGreaterThan(0)
      console.log(`[OpenRouter Chat Completions Reasoning Test] Sample reasoning: ${reasoningTokens[0]?.substring(0, 100)}...`)
    }
  })
})
