/**
 * Custom Services E2E Tests
 *
 * End-to-end tests for custom service registration, management, and RPC communication.
 * These tests use the ICustomService interface with service.call() pattern.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { newMessagePortRpcSession, type RpcStub } from 'capnweb'
import { createMainRpcHost, type MainRpcHost } from '../../src/rpc-host'
import type { SandboxMainService, JsonSchema } from '@pubwiki/sandbox-service'
import type { ICustomService, ServiceDefinition } from '../../src/types'

// =============================================================================
// Helper Functions for Creating Mock ICustomService Implementations
// =============================================================================

/**
 * Create a basic mock ICustomService with configurable behavior
 */
function createMockService(
  name: string,
  namespace: string,
  handler: (inputs: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>,
  options?: {
    kind?: 'ACTION' | 'PURE'
    description?: string
    inputs?: Record<string, JsonSchema>
    outputs?: Record<string, JsonSchema>
  }
): ICustomService {
  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      return handler(inputs)
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name,
        namespace,
        identifier: `${namespace}:${name}`,
        kind: options?.kind ?? 'PURE',
        description: options?.description,
        inputs: { type: 'object', properties: options?.inputs },
        outputs: { type: 'object', properties: options?.outputs }
      }
    }
  }
}

/**
 * Create a stateful service with internal state management
 */
function createStatefulService<TState>(
  name: string,
  namespace: string,
  initialState: TState,
  handlers: Record<string, (state: TState, inputs: Record<string, unknown>) => { state?: TState; outputs: Record<string, unknown> }>
): ICustomService {
  let state = initialState

  return {
    async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
      const action = inputs.action as string
      const handler = handlers[action]
      if (!handler) {
        throw new Error(`Unknown action: ${action}`)
      }
      const result = handler(state, inputs)
      if (result.state !== undefined) {
        state = result.state
      }
      return result.outputs
    },
    async getDefinition(): Promise<ServiceDefinition> {
      return {
        name,
        namespace,
        identifier: `${namespace}:${name}`,
        kind: 'ACTION',
        inputs: { type: 'object' },
        outputs: { type: 'object' }
      }
    }
  }
}

describe('Custom Services E2E', () => {
  let channel: MessageChannel
  let host: MainRpcHost
  let client: RpcStub<SandboxMainService>

  beforeEach(() => {
    channel = new MessageChannel()
    host = createMainRpcHost(channel.port1, { basePath: '/demo' })
    client = newMessagePortRpcSession<SandboxMainService>(channel.port2, {})
    channel.port1.start()
    channel.port2.start()
  })

  afterEach(() => {
    if (host) host.disconnect()
    channel.port1.close()
    channel.port2.close()
  })

  describe('Complex Data Types via service.call()', () => {
    it('should support complex custom service types through service.call()', async () => {
      // Define a Todo service with internal state
      interface Todo {
        id: string
        title: string
        completed: boolean
        createdAt: number
      }

      interface TodoState {
        todos: Map<string, Todo>
        idCounter: number
      }

      const todoService = createStatefulService<TodoState>(
        'todos',
        'demo',
        { todos: new Map(), idCounter: 0 },
        {
          create: (state, inputs) => {
            const id = `todo-${++state.idCounter}`
            const todo: Todo = {
              id,
              title: inputs.title as string,
              completed: false,
              createdAt: Date.now()
            }
            state.todos.set(id, todo)
            return { state, outputs: { todo } }
          },
          get: (state, inputs) => {
            const todo = state.todos.get(inputs.id as string) ?? null
            return { outputs: { todo } }
          },
          list: (state) => {
            return { outputs: { todos: Array.from(state.todos.values()) } }
          },
          toggle: (state, inputs) => {
            const todo = state.todos.get(inputs.id as string)
            if (todo) {
              todo.completed = !todo.completed
            }
            return { state, outputs: { todo: todo ?? null } }
          },
          delete: (state, inputs) => {
            const deleted = state.todos.delete(inputs.id as string)
            return { state, outputs: { deleted } }
          },
          clear: (state) => {
            state.todos.clear()
            state.idCounter = 0
            return { state, outputs: {} }
          }
        }
      )

      // Register service on host
      host.registerService('todos', todoService)

      // Access service via host.getService()
      const service = host.getService('todos')
      expect(service).toBeDefined()

      // Test via service.call()
      const result1 = await service!.call({ action: 'create', title: 'Learn TypeScript' })
      const todo1 = result1.todo as Todo
      
      const result2 = await service!.call({ action: 'create', title: 'Build sandbox-host' })
      const todo2 = result2.todo as Todo
      
      await service!.call({ action: 'create', title: 'Write tests' })

      expect(todo1.id).toBe('todo-1')
      expect(todo1.title).toBe('Learn TypeScript')
      expect(todo1.completed).toBe(false)

      const listResult = await service!.call({ action: 'list' })
      const allTodos = listResult.todos as Todo[]
      expect(allTodos.length).toBe(3)

      // Toggle via service.call()
      const toggleResult = await service!.call({ action: 'toggle', id: todo1.id })
      const toggled = toggleResult.todo as Todo
      expect(toggled.completed).toBe(true)

      // Get via service.call()
      const getResult = await service!.call({ action: 'get', id: todo1.id })
      const fetched = getResult.todo as Todo
      expect(fetched.completed).toBe(true)

      // Delete via service.call()
      const deleteResult = await service!.call({ action: 'delete', id: todo2.id })
      expect(deleteResult.deleted).toBe(true)

      const remainingResult = await service!.call({ action: 'list' })
      const remaining = remainingResult.todos as Todo[]
      expect(remaining.length).toBe(2)

      // Clear via service.call()
      await service!.call({ action: 'clear' })
      const afterClearResult = await service!.call({ action: 'list' })
      const afterClear = afterClearResult.todos as Todo[]
      expect(afterClear.length).toBe(0)
    })
  })

  describe('Async Service Operations', () => {
    it('should support async service methods through service.call()', async () => {
      const cache = new Map<string, unknown>()

      const asyncDataService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'fetch': {
              await new Promise(resolve => setTimeout(resolve, 10))
              const value = cache.get(inputs.key as string) ?? null
              return { value }
            }
            case 'save': {
              await new Promise(resolve => setTimeout(resolve, 10))
              cache.set(inputs.key as string, inputs.value)
              return { success: true }
            }
            case 'delete': {
              await new Promise(resolve => setTimeout(resolve, 5))
              const deleted = cache.delete(inputs.key as string)
              return { deleted }
            }
            case 'bulkSave': {
              await new Promise(resolve => setTimeout(resolve, 20))
              const items = inputs.items as Array<{ key: string; value: unknown }>
              for (const item of items) {
                cache.set(item.key, item.value)
              }
              return { count: items.length }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'asyncData',
            namespace: 'demo',
            identifier: 'demo:asyncData',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('asyncData', asyncDataService)

      const service = host.getService('asyncData')
      expect(service).toBeDefined()

      // Test async operations via service.call()
      await service!.call({ action: 'save', key: 'user:1', value: { name: 'Alice', age: 30 } })
      await service!.call({ action: 'save', key: 'user:2', value: { name: 'Bob', age: 25 } })

      const user1Result = await service!.call({ action: 'fetch', key: 'user:1' })
      expect(user1Result.value).toEqual({ name: 'Alice', age: 30 })

      const nonExistentResult = await service!.call({ action: 'fetch', key: 'user:999' })
      expect(nonExistentResult.value).toBeNull()

      // Test bulk save via service.call()
      const bulkResult = await service!.call({
        action: 'bulkSave',
        items: [
          { key: 'item:1', value: 'first' },
          { key: 'item:2', value: 'second' },
          { key: 'item:3', value: 'third' }
        ]
      })
      expect(bulkResult.count).toBe(3)

      // Test delete via service.call()
      const deleteResult = await service!.call({ action: 'delete', key: 'user:1' })
      expect(deleteResult.deleted).toBe(true)

      const deletedUserResult = await service!.call({ action: 'fetch', key: 'user:1' })
      expect(deletedUserResult.value).toBeNull()
    })
  })

  describe('Multiple Services', () => {
    it('should support multiple services with different schemas', async () => {
      // User service
      const users = new Map<string, { id: string; name: string; email: string }>()
      let userIdCounter = 0

      const userService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string
          switch (action) {
            case 'create': {
              const id = `user-${++userIdCounter}`
              const user = { id, name: inputs.name as string, email: inputs.email as string }
              users.set(id, user)
              return { user }
            }
            case 'get': {
              const user = users.get(inputs.id as string) ?? null
              return { user }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'users',
            namespace: 'demo',
            identifier: 'demo:users',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      // Auth service
      const sessions = new Map<string, { userId: string; token: string; expiresAt: number }>()

      const authService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string
          switch (action) {
            case 'login': {
              const token = `token-${Math.random().toString(36).slice(2)}`
              const expiresAt = Date.now() + 3600000
              const session = { userId: inputs.userId as string, token, expiresAt }
              sessions.set(token, session)
              return { token, expiresAt }
            }
            case 'validate': {
              const session = sessions.get(inputs.token as string)
              const valid = session !== undefined && session.expiresAt > Date.now()
              return { valid }
            }
            case 'logout': {
              const deleted = sessions.delete(inputs.token as string)
              return { deleted }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'auth',
            namespace: 'demo',
            identifier: 'demo:auth',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      // Logger service
      const logs: Array<{ level: string; message: string; timestamp: number }> = []

      const loggerService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string
          switch (action) {
            case 'log': {
              logs.push({
                level: inputs.level as string,
                message: inputs.message as string,
                timestamp: Date.now()
              })
              return {}
            }
            case 'getLogs': {
              const level = inputs.level as string | undefined
              const filteredLogs = level ? logs.filter(log => log.level === level) : [...logs]
              return { logs: filteredLogs }
            }
            case 'clear': {
              logs.length = 0
              return {}
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'logger',
            namespace: 'demo',
            identifier: 'demo:logger',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      // Register all services
      host.registerService('users', userService)
      host.registerService('auth', authService)
      host.registerService('logger', loggerService)

      // Access all services
      const usersService = host.getService('users')
      const authSvc = host.getService('auth')
      const loggerSvc = host.getService('logger')

      expect(usersService).toBeDefined()
      expect(authSvc).toBeDefined()
      expect(loggerSvc).toBeDefined()

      // Create a user via service.call()
      const userResult = await usersService!.call({ action: 'create', name: 'Alice', email: 'alice@example.com' })
      const user = userResult.user as { id: string; name: string; email: string }
      await loggerSvc!.call({ action: 'log', level: 'info', message: `User created: ${user.id}` })

      // Login via service.call()
      const sessionResult = await authSvc!.call({ action: 'login', userId: user.id })
      const token = sessionResult.token as string
      await loggerSvc!.call({ action: 'log', level: 'info', message: `User logged in: ${user.id}` })

      // Validate token via service.call()
      const validateResult1 = await authSvc!.call({ action: 'validate', token })
      expect(validateResult1.valid).toBe(true)
      
      const validateResult2 = await authSvc!.call({ action: 'validate', token: 'invalid-token' })
      expect(validateResult2.valid).toBe(false)

      // Logout via service.call()
      await authSvc!.call({ action: 'logout', token })
      await loggerSvc!.call({ action: 'log', level: 'info', message: `User logged out: ${user.id}` })

      // Check logs via service.call()
      const allLogsResult = await loggerSvc!.call({ action: 'getLogs' })
      const allLogs = allLogsResult.logs as Array<{ level: string; message: string; timestamp: number }>
      expect(allLogs.length).toBe(3)

      const infoLogsResult = await loggerSvc!.call({ action: 'getLogs', level: 'info' })
      const infoLogs = infoLogsResult.logs as Array<{ level: string; message: string; timestamp: number }>
      expect(infoLogs.length).toBe(3)
    })
  })

  describe('Service Replacement', () => {
    it('should handle service replacement correctly', async () => {
      // Original service - V1
      const greetingServiceV1: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const name = inputs.name as string
          return { message: `Hello, ${name}!` }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'greeting',
            namespace: 'demo',
            identifier: 'demo:greeting',
            kind: 'PURE',
            inputs: { type: 'object', properties: { name: { type: 'string' } } },
            outputs: { type: 'object', properties: { message: { type: 'string' } } }
          }
        }
      }

      // Updated service - V2
      const greetingServiceV2: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string
          const name = inputs.name as string
          if (action === 'greet') {
            return { message: `Welcome, ${name}!` }
          } else if (action === 'farewell') {
            return { message: `Goodbye, ${name}!` }
          }
          throw new Error(`Unknown action: ${action}`)
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'greeting',
            namespace: 'demo',
            identifier: 'demo:greeting',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      // Register V1
      host.registerService('greeting', greetingServiceV1)

      // Test V1 via service.call()
      const serviceV1 = host.getService('greeting')
      const greetV1Result = await serviceV1!.call({ name: 'Alice' })
      expect(greetV1Result.message).toBe('Hello, Alice!')

      // Replace with V2
      host.registerService('greeting', greetingServiceV2)

      // Test V2 via service.call() (same service ID, but implementation changed)
      const serviceV2 = host.getService('greeting')
      const greetV2Result = await serviceV2!.call({ action: 'greet', name: 'Alice' })
      expect(greetV2Result.message).toBe('Welcome, Alice!')
      
      const farewellResult = await serviceV2!.call({ action: 'farewell', name: 'Alice' })
      expect(farewellResult.message).toBe('Goodbye, Alice!')
    })
  })

  describe('Complex Nested Data Types via service.call()', () => {
    it('should support services with complex nested data types', async () => {
      interface TreeNode {
        id: string
        value: unknown
        children: TreeNode[]
        metadata?: {
          createdAt: number
          updatedAt: number
          tags: string[]
        }
      }

      interface TreeState {
        root: TreeNode | null
        nodeCounter: number
      }

      const treeService = createStatefulService<TreeState>(
        'tree',
        'demo',
        { root: null, nodeCounter: 0 },
        {
          createTree: (state, inputs) => {
            state.root = {
              id: 'root',
              value: inputs.rootValue,
              children: [],
              metadata: {
                createdAt: Date.now(),
                updatedAt: Date.now(),
                tags: []
              }
            }
            return { state, outputs: { node: state.root } }
          },
          addChild: (state, inputs) => {
            const parentId = inputs.parentId as string
            const parent = findNode(state.root, parentId)
            if (!parent) {
              return { outputs: { node: null } }
            }
            const child: TreeNode = {
              id: `node-${++state.nodeCounter}`,
              value: inputs.value,
              children: [],
              metadata: {
                createdAt: Date.now(),
                updatedAt: Date.now(),
                tags: []
              }
            }
            parent.children.push(child)
            return { state, outputs: { node: child } }
          },
          findNode: (state, inputs) => {
            const node = findNode(state.root, inputs.id as string)
            return { outputs: { node } }
          },
          getDepth: (state) => {
            const depth = calculateDepth(state.root)
            return { outputs: { depth } }
          },
          addTag: (state, inputs) => {
            const node = findNode(state.root, inputs.nodeId as string)
            if (!node || !node.metadata) {
              return { outputs: { success: false } }
            }
            node.metadata.tags.push(inputs.tag as string)
            node.metadata.updatedAt = Date.now()
            return { state, outputs: { success: true } }
          },
          getTags: (state, inputs) => {
            const node = findNode(state.root, inputs.nodeId as string)
            return { outputs: { tags: node?.metadata?.tags ?? [] } }
          }
        }
      )

      function findNode(node: TreeNode | null, id: string): TreeNode | null {
        if (!node) return null
        if (node.id === id) return node
        for (const child of node.children) {
          const found = findNode(child, id)
          if (found) return found
        }
        return null
      }

      function calculateDepth(node: TreeNode | null): number {
        if (!node) return 0
        if (node.children.length === 0) return 1
        return 1 + Math.max(...node.children.map(c => calculateDepth(c)))
      }

      host.registerService('tree', treeService)

      const service = host.getService('tree')
      expect(service).toBeDefined()

      // Build tree via service.call()
      const createResult = await service!.call({ action: 'createTree', rootValue: { name: 'Root' } })
      const root = createResult.node as TreeNode
      expect(root.id).toBe('root')
      expect(root.children).toHaveLength(0)

      const child1Result = await service!.call({ action: 'addChild', parentId: 'root', value: { name: 'Child 1' } })
      const child1 = child1Result.node as TreeNode
      
      await service!.call({ action: 'addChild', parentId: 'root', value: { name: 'Child 2' } })

      const rootNodeResult = await service!.call({ action: 'findNode', id: 'root' })
      const rootNode = rootNodeResult.node as TreeNode
      expect(rootNode.children).toHaveLength(2)

      // Add grandchildren via service.call()
      await service!.call({ action: 'addChild', parentId: child1.id, value: { name: 'Grandchild 1' } })
      await service!.call({ action: 'addChild', parentId: child1.id, value: { name: 'Grandchild 2' } })

      const depthResult = await service!.call({ action: 'getDepth' })
      expect(depthResult.depth).toBe(3)

      // Test metadata operations via service.call()
      await service!.call({ action: 'addTag', nodeId: 'root', tag: 'important' })
      await service!.call({ action: 'addTag', nodeId: 'root', tag: 'primary' })
      const rootTagsResult = await service!.call({ action: 'getTags', nodeId: 'root' })
      expect(rootTagsResult.tags).toEqual(['important', 'primary'])

      await service!.call({ action: 'addTag', nodeId: child1.id, tag: 'category:a' })
      const child1TagsResult = await service!.call({ action: 'getTags', nodeId: child1.id })
      expect(child1TagsResult.tags).toEqual(['category:a'])
    })
  })

  describe('Error Handling', () => {
    it('should support services with error handling', async () => {
      const validationService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'validateEmail': {
              const email = inputs.email as string
              if (!email) {
                return { valid: false, error: 'Email is required' }
              }
              if (!email.includes('@')) {
                return { valid: false, error: 'Invalid email format' }
              }
              if (email.length > 254) {
                return { valid: false, error: 'Email too long' }
              }
              return { valid: true }
            }
            case 'validatePassword': {
              const password = inputs.password as string
              const errors: string[] = []

              if (!password) {
                errors.push('Password is required')
              } else {
                if (password.length < 8) {
                  errors.push('Password must be at least 8 characters')
                }
                if (!/[A-Z]/.test(password)) {
                  errors.push('Password must contain uppercase letter')
                }
                if (!/[a-z]/.test(password)) {
                  errors.push('Password must contain lowercase letter')
                }
                if (!/[0-9]/.test(password)) {
                  errors.push('Password must contain a number')
                }
              }

              return { valid: errors.length === 0, errors }
            }
            case 'validateAge': {
              const age = inputs.age as unknown
              if (typeof age !== 'number') {
                return { valid: false, error: 'Age must be a number' }
              }
              if (!Number.isInteger(age)) {
                return { valid: false, error: 'Age must be an integer' }
              }
              if (age < 0 || age > 150) {
                return { valid: false, error: 'Age must be between 0 and 150' }
              }
              return { valid: true, value: age }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'validation',
            namespace: 'demo',
            identifier: 'demo:validation',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('validation', validationService)

      const service = host.getService('validation')
      expect(service).toBeDefined()

      // Test email validation via service.call()
      expect(await service!.call({ action: 'validateEmail', email: '' })).toEqual({ valid: false, error: 'Email is required' })
      expect(await service!.call({ action: 'validateEmail', email: 'invalid' })).toEqual({ valid: false, error: 'Invalid email format' })
      expect(await service!.call({ action: 'validateEmail', email: 'user@example.com' })).toEqual({ valid: true })

      // Test password validation via service.call()
      const weakPasswordResult = await service!.call({ action: 'validatePassword', password: 'weak' })
      expect(weakPasswordResult.valid).toBe(false)
      const weakErrors = weakPasswordResult.errors as string[]
      expect(weakErrors).toContain('Password must be at least 8 characters')
      expect(weakErrors).toContain('Password must contain uppercase letter')
      expect(weakErrors).toContain('Password must contain a number')

      const strongPasswordResult = await service!.call({ action: 'validatePassword', password: 'StrongPass123' })
      expect(strongPasswordResult.valid).toBe(true)
      expect((strongPasswordResult.errors as string[]).length).toBe(0)

      // Test age validation via service.call()
      expect(await service!.call({ action: 'validateAge', age: 'not a number' })).toEqual({ valid: false, error: 'Age must be a number' })
      expect(await service!.call({ action: 'validateAge', age: 25.5 })).toEqual({ valid: false, error: 'Age must be an integer' })
      expect(await service!.call({ action: 'validateAge', age: -5 })).toEqual({ valid: false, error: 'Age must be between 0 and 150' })
      expect(await service!.call({ action: 'validateAge', age: 25 })).toEqual({ valid: true, value: 25 })
    })

    it('should propagate errors from service.call()', async () => {
      const errorService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'throwSync':
              throw new Error('Sync error from service')
            case 'throwAsync':
              await new Promise(resolve => setTimeout(resolve, 10))
              throw new Error('Async error from service')
            case 'maybeThrow': {
              const shouldThrow = inputs.shouldThrow as boolean
              if (shouldThrow) {
                throw new Error('Conditional error')
              }
              return { result: 'success' }
            }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'errorService',
            namespace: 'demo',
            identifier: 'demo:errorService',
            kind: 'ACTION',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('errorService', errorService)

      const service = host.getService('errorService')
      expect(service).toBeDefined()

      // Test sync error via service.call()
      await expect(service!.call({ action: 'throwSync' })).rejects.toThrow('Sync error from service')

      // Test async error via service.call()
      await expect(service!.call({ action: 'throwAsync' })).rejects.toThrow('Async error from service')

      // Test conditional error via service.call()
      const successResult = await service!.call({ action: 'maybeThrow', shouldThrow: false })
      expect(successResult.result).toBe('success')
      await expect(service!.call({ action: 'maybeThrow', shouldThrow: true })).rejects.toThrow('Conditional error')
    })
  })

  describe('Service Listing via listServices()', () => {
    it('should list all registered services via client.listServices()', async () => {
      // Register multiple services with different definitions
      const calculatorService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const a = inputs.a as number
          const b = inputs.b as number
          const op = inputs.operation as string
          
          switch (op) {
            case 'add': return { result: a + b }
            case 'subtract': return { result: a - b }
            case 'multiply': return { result: a * b }
            case 'divide': return { result: a / b }
            default: throw new Error(`Unknown operation: ${op}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'calculator',
            namespace: 'math',
            identifier: 'math:calculator',
            kind: 'PURE',
            description: 'Basic arithmetic operations',
            inputs: {
              type: 'object',
              properties: {
                a: { type: 'number' },
                b: { type: 'number' },
                operation: { type: 'string' }
              }
            },
            outputs: {
              type: 'object',
              properties: {
                result: { type: 'number' }
              }
            }
          }
        }
      }

      const storageService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          // Simple mock implementation
          return { stored: true }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'storage',
            namespace: 'data',
            identifier: 'data:storage',
            kind: 'ACTION',
            description: 'Persistent storage service',
            inputs: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                value: { type: 'object' }
              }
            },
            outputs: {
              type: 'object',
              properties: {
                stored: { type: 'boolean' }
              }
            }
          }
        }
      }

      host.registerService('calculator', calculatorService)
      host.registerService('storage', storageService)

      // List services via RPC client
      const services: ServiceDefinition[] = await client.listServices()

      expect(services).toHaveLength(2)

      const calculatorDef = services.find((s: ServiceDefinition) => s.identifier === 'math:calculator')
      expect(calculatorDef).toBeDefined()
      expect(calculatorDef!.name).toBe('calculator')
      expect(calculatorDef!.namespace).toBe('math')
      expect(calculatorDef!.kind).toBe('PURE')
      expect(calculatorDef!.description).toBe('Basic arithmetic operations')

      const storageDef = services.find((s: ServiceDefinition) => s.identifier === 'data:storage')
      expect(storageDef).toBeDefined()
      expect(storageDef!.name).toBe('storage')
      expect(storageDef!.namespace).toBe('data')
      expect(storageDef!.kind).toBe('ACTION')
      expect(storageDef!.description).toBe('Persistent storage service')
    })

    it('should return empty array when no services are registered', async () => {
      const services = await client.listServices()
      expect(services).toHaveLength(0)
    })
  })

  describe('Config and Dynamic Registration', () => {
    it('should support services registered via config and dynamic registration', async () => {
      // Close default channel
      host.disconnect()
      channel.port1.close()
      channel.port2.close()

      // Pre-configured service factory
      const configServiceFactory = (): ICustomService => {
        const config: Record<string, string> = {
          apiUrl: 'https://api.example.com',
          version: '1.0.0'
        }

        return {
          async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
            const action = inputs.action as string
            switch (action) {
              case 'get':
                return { value: config[inputs.key as string] ?? null }
              case 'set':
                config[inputs.key as string] = inputs.value as string
                return {}
              default:
                throw new Error(`Unknown action: ${action}`)
            }
          },
          async getDefinition(): Promise<ServiceDefinition> {
            return {
              name: 'config',
              namespace: 'demo',
              identifier: 'demo:config',
              kind: 'ACTION',
              inputs: { type: 'object' },
              outputs: { type: 'object' }
            }
          }
        }
      }

      // Create new channel with customServices
      const customServices = new Map<string, () => ICustomService>([
        ['config', configServiceFactory]
      ])

      channel = new MessageChannel()
      host = createMainRpcHost(channel.port1, {
        basePath: '/demo',
        customServices
      })
      client = newMessagePortRpcSession<SandboxMainService>(channel.port2, {})
      channel.port1.start()
      channel.port2.start()

      // Verify config service is available
      const configService = host.getService('config')
      expect(configService).toBeDefined()
      
      const apiUrlResult = await configService!.call({ action: 'get', key: 'apiUrl' })
      expect(apiUrlResult.value).toBe('https://api.example.com')

      // Dynamically register another service
      const runtimeService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const startTime = Date.now()
          const pid = 'sandbox-1'
          
          const action = inputs.action as string
          switch (action) {
            case 'getUptime':
              return { uptime: Date.now() - startTime }
            case 'getInfo':
              return { startTime, pid }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'runtime',
            namespace: 'demo',
            identifier: 'demo:runtime',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('runtime', runtimeService)

      // Both services should work
      await configService!.call({ action: 'set', key: 'newKey', value: 'newValue' })
      const newKeyResult = await configService!.call({ action: 'get', key: 'newKey' })
      expect(newKeyResult.value).toBe('newValue')

      const runtime = host.getService('runtime')
      expect(runtime).toBeDefined()
      
      const uptimeResult = await runtime!.call({ action: 'getUptime' })
      expect(uptimeResult.uptime).toBeGreaterThanOrEqual(0)
      
      const infoResult = await runtime!.call({ action: 'getInfo' })
      expect(infoResult.pid).toBe('sandbox-1')
    })
  })

  describe('State Isolation', () => {
    it('should maintain service state isolation between hosts', async () => {
      // Create two separate channels and hosts
      const channel1 = new MessageChannel()
      const channel2 = new MessageChannel()

      const host1 = createMainRpcHost(channel1.port1, { basePath: '/demo1' })
      const host2 = createMainRpcHost(channel2.port1, { basePath: '/demo2' })

      channel1.port1.start()
      channel1.port2.start()
      channel2.port1.start()
      channel2.port2.start()

      // Create counter service factory
      function createCounterService(): ICustomService {
        let count = 0

        return {
          async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
            const action = inputs.action as string
            switch (action) {
              case 'increment':
                return { count: ++count }
              case 'decrement':
                return { count: --count }
              case 'getCount':
                return { count }
              case 'reset':
                count = 0
                return {}
              default:
                throw new Error(`Unknown action: ${action}`)
            }
          },
          async getDefinition(): Promise<ServiceDefinition> {
            return {
              name: 'counter',
              namespace: 'demo',
              identifier: 'demo:counter',
              kind: 'ACTION',
              inputs: { type: 'object' },
              outputs: { type: 'object' }
            }
          }
        }
      }

      // Register counter service on both hosts (each has its own state)
      host1.registerService('counter', createCounterService())
      host2.registerService('counter', createCounterService())

      // Operate on counter1
      const counter1 = host1.getService('counter')!
      await counter1.call({ action: 'increment' })
      await counter1.call({ action: 'increment' })
      await counter1.call({ action: 'increment' })
      const count1Result = await counter1.call({ action: 'getCount' })
      expect(count1Result.count).toBe(3)

      // Counter2 should be independent
      const counter2 = host2.getService('counter')!
      const count2Result = await counter2.call({ action: 'getCount' })
      expect(count2Result.count).toBe(0)
      
      await counter2.call({ action: 'increment' })
      const count2AfterResult = await counter2.call({ action: 'getCount' })
      expect(count2AfterResult.count).toBe(1)

      // Counter1 should still be 3
      const count1FinalResult = await counter1.call({ action: 'getCount' })
      expect(count1FinalResult.count).toBe(3)

      // Cleanup
      host1.disconnect()
      host2.disconnect()
      channel1.port1.close()
      channel1.port2.close()
      channel2.port1.close()
      channel2.port2.close()
    })
  })

  describe('Large Data Transfer', () => {
    it('should handle large data transfer through service.call()', async () => {
      const dataService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string

          switch (action) {
            case 'generateLargeArray': {
              const size = inputs.size as number
              return { data: Array.from({ length: size }, (_, i) => i) }
            }
            case 'generateLargeObject': {
              const size = inputs.size as number
              const obj: Record<string, string> = {}
              for (let i = 0; i < size; i++) {
                obj[`key${i}`] = `value${i}_${'x'.repeat(100)}`
              }
              return { data: obj }
            }
            case 'echoData':
              return { data: inputs.data }
            default:
              throw new Error(`Unknown action: ${action}`)
          }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'dataService',
            namespace: 'demo',
            identifier: 'demo:dataService',
            kind: 'PURE',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      host.registerService('dataService', dataService)

      const service = host.getService('dataService')
      expect(service).toBeDefined()

      // Test large array via service.call()
      const largeArrayResult = await service!.call({ action: 'generateLargeArray', size: 1000 })
      const largeArray = largeArrayResult.data as number[]
      expect(largeArray.length).toBe(1000)
      expect(largeArray[0]).toBe(0)
      expect(largeArray[999]).toBe(999)

      // Test large object via service.call()
      const largeObjectResult = await service!.call({ action: 'generateLargeObject', size: 100 })
      const largeObject = largeObjectResult.data as Record<string, string>
      expect(Object.keys(largeObject).length).toBe(100)
      expect(largeObject.key0).toContain('value0')

      // Test echo with nested data via service.call()
      const nestedData = {
        level1: {
          level2: {
            level3: {
              array: [1, 2, 3, { nested: true }],
              value: 'deep'
            }
          }
        }
      }
      const echoedResult = await service!.call({ action: 'echoData', data: nestedData })
      expect(echoedResult.data).toEqual(nestedData)
    })
  })

  describe('Service Definition Schema', () => {
    it('should return proper JSON Schema in getDefinition()', async () => {
      const userService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          return { success: true }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'userManager',
            namespace: 'admin',
            identifier: 'admin:userManager',
            kind: 'ACTION',
            description: 'Manages user accounts',
            inputs: {
              type: 'object',
              properties: {
                action: { type: 'string', description: 'Action to perform' },
                userId: { type: 'string', description: 'User ID' },
                userData: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    email: { type: 'string' },
                    roles: {
                      type: 'array',
                      items: { type: 'string' }
                    }
                  },
                  required: ['name', 'email']
                }
              },
              required: ['action']
            },
            outputs: {
              type: 'object',
              properties: {
                success: { type: 'boolean' },
                user: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    email: { type: 'string' }
                  }
                },
                error: { type: 'string' }
              }
            }
          }
        }
      }

      host.registerService('userManager', userService)

      const service = host.getService('userManager')
      expect(service).toBeDefined()

      const definition = await service!.getDefinition()

      // Verify basic properties
      expect(definition.name).toBe('userManager')
      expect(definition.namespace).toBe('admin')
      expect(definition.identifier).toBe('admin:userManager')
      expect(definition.kind).toBe('ACTION')
      expect(definition.description).toBe('Manages user accounts')

      // Verify inputs schema
      expect(definition.inputs.type).toBe('object')
      expect(definition.inputs.properties).toBeDefined()
      expect(definition.inputs.properties!.action).toEqual({ type: 'string', description: 'Action to perform' })
      expect(definition.inputs.required).toContain('action')

      // Verify nested input schema
      const userDataSchema = definition.inputs.properties!.userData as Record<string, unknown>
      expect(userDataSchema.type).toBe('object')
      expect((userDataSchema.properties as Record<string, unknown>).roles).toEqual({
        type: 'array',
        items: { type: 'string' }
      })

      // Verify outputs schema
      expect(definition.outputs.type).toBe('object')
      expect(definition.outputs.properties).toBeDefined()
      expect(definition.outputs.properties!.success).toEqual({ type: 'boolean' })
    })
  })

  describe('RPC Client Access to Services', () => {
    it('should access services through RPC client as ICustomService', async () => {
      const echoService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          return { echo: `Echo: ${inputs.message}` }
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'echo',
            namespace: 'test',
            identifier: 'test:echo',
            kind: 'PURE',
            inputs: { type: 'object', properties: { message: { type: 'string' } } },
            outputs: { type: 'object', properties: { echo: { type: 'string' } } }
          }
        }
      }

      host.registerService('echo', echoService)

      // Access via RPC client property (exposed as prototype getter)
      const rpcEchoService = (client as unknown as Record<string, ICustomService>).echo
      expect(rpcEchoService).toBeDefined()

      // Call via RPC
      const result = await rpcEchoService.call({ message: 'Hello World' })
      expect(result.echo).toBe('Echo: Hello World')

      // Get definition via RPC
      const definition = await rpcEchoService.getDefinition()
      expect(definition.identifier).toBe('test:echo')
    })
  })
})
