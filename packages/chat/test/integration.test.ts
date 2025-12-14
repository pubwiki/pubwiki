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
import type { ChatStreamEvent, VfsProvider, VFSStat } from '../src/index'

// Load environment variables
config()

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

// Skip tests if no API key
const describeIfApiKey = OPENROUTER_API_KEY ? describe : describe.skip

describeIfApiKey('PubChat Integration Tests', () => {
  let pubchat: PubChat
  let messageStore: MemoryMessageStore
  
  beforeAll(() => {
    messageStore = new MemoryMessageStore()
    pubchat = new PubChat({
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'google/gemini-2.5-flash',  // Fast and cheap model for testing
        temperature: 0,
      },
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
      
      // Verify content contains the numbers
      const fullContent = tokens.join('')
      expect(fullContent).toMatch(/1.*2.*3.*4.*5/)
    })

    it('should handle errors gracefully', async () => {
      const invalidPubchat = new PubChat({
        llm: {
          apiKey: 'invalid-key',
          baseUrl: OPENROUTER_BASE_URL,
          model: 'openai/gpt-4o-mini',
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
        llm: {
          apiKey: OPENROUTER_API_KEY!,
          baseUrl: OPENROUTER_BASE_URL,
          model: 'openai/gpt-4o-mini',
          temperature: 0,
        },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
        temperature: 0,
      },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
        temperature: 0,
      },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
      },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
      },
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
      async id(path: string): Promise<string> {
        return `id-${path}`
      },
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
      async stat(path: string): Promise<VFSStat> {
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
      },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
        temperature: 0,
      },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
        temperature: 0,
      },
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
      llm: {
        apiKey: OPENROUTER_API_KEY!,
        baseUrl: OPENROUTER_BASE_URL,
        model: 'openai/gpt-4o-mini',
        temperature: 0,
      },
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
