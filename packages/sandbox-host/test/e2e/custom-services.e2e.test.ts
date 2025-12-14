/**
 * Custom Services E2E Tests
 *
 * End-to-end tests for custom service registration, management, and RPC communication.
 * These tests use real MessagePort RPC communication between host and client.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { newMessagePortRpcSession, RpcTarget, type RpcStub } from 'capnweb'
import { createMainRpcHost, type MainRpcHost } from '../../src/rpc-host'
import type { SandboxMainService } from '@pubwiki/sandbox-service'
import { z } from 'zod/v4'

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

  describe('Complex Service Types via RPC', () => {
    it('should support complex custom service types through RPC', async () => {
      // Define a Todo service
      interface Todo {
        id: string
        title: string
        completed: boolean
        createdAt: number
      }

      class TodoService extends RpcTarget {
        private todos: Map<string, Todo> = new Map()
        private idCounter = 0

        create(title: string): Todo {
          const id = `todo-${++this.idCounter}`
          const todo: Todo = {
            id,
            title,
            completed: false,
            createdAt: Date.now()
          }
          this.todos.set(id, todo)
          return todo
        }

        get(id: string): Todo | null {
          return this.todos.get(id) ?? null
        }

        list(): Todo[] {
          return Array.from(this.todos.values())
        }

        toggle(id: string): Todo | null {
          const todo = this.todos.get(id)
          if (todo) {
            todo.completed = !todo.completed
          }
          return todo ?? null
        }

        deleteTodo(id: string): boolean {
          return this.todos.delete(id)
        }

        clear(): void {
          this.todos.clear()
          this.idCounter = 0
        }
      }

      const todoSchema = z.object({
        create: z.function(),
        get: z.function(),
        list: z.function(),
        toggle: z.function(),
        deleteTodo: z.function(),
        clear: z.function()
      })

      // Register service on host
      host.registerService({
        id: 'todos',
        schema: todoSchema,
        implementation: new TodoService()
      })

      // Access service via RPC client
      const todos = (client as any).todos

      // Test via RPC
      const todo1 = await todos.create('Learn TypeScript')
      const todo2 = await todos.create('Build sandbox-host')
      const todo3 = await todos.create('Write tests')

      expect(todo1.id).toBe('todo-1')
      expect(todo1.title).toBe('Learn TypeScript')
      expect(todo1.completed).toBe(false)

      const allTodos = await todos.list()
      expect(allTodos.length).toBe(3)

      // Toggle via RPC
      const toggled = await todos.toggle(todo1.id)
      expect(toggled.completed).toBe(true)

      // Get via RPC
      const fetched = await todos.get(todo1.id)
      expect(fetched.completed).toBe(true)

      // Delete via RPC
      const deleted = await todos.deleteTodo(todo2.id)
      expect(deleted).toBe(true)

      const remaining = await todos.list()
      expect(remaining.length).toBe(2)

      // Clear via RPC
      await todos.clear()
      const afterClear = await todos.list()
      expect(afterClear.length).toBe(0)
    })
  })

  describe('Async Service Methods via RPC', () => {
    it('should support async service methods through RPC', async () => {
      class AsyncDataService extends RpcTarget {
        private cache: Map<string, unknown> = new Map()

        async fetch(key: string): Promise<unknown> {
          await new Promise(resolve => setTimeout(resolve, 10))
          return this.cache.get(key) ?? null
        }

        async save(key: string, value: unknown): Promise<boolean> {
          await new Promise(resolve => setTimeout(resolve, 10))
          this.cache.set(key, value)
          return true
        }

        async deleteKey(key: string): Promise<boolean> {
          await new Promise(resolve => setTimeout(resolve, 5))
          return this.cache.delete(key)
        }

        async bulkSave(items: Array<{ key: string; value: unknown }>): Promise<number> {
          await new Promise(resolve => setTimeout(resolve, 20))
          for (const item of items) {
            this.cache.set(item.key, item.value)
          }
          return items.length
        }
      }

      host.registerService({
        id: 'asyncData',
        schema: z.object({
          fetch: z.function(),
          save: z.function(),
          deleteKey: z.function(),
          bulkSave: z.function()
        }),
        implementation: new AsyncDataService()
      })

      const service = (client as any).asyncData

      // Test async operations via RPC
      await service.save('user:1', { name: 'Alice', age: 30 })
      await service.save('user:2', { name: 'Bob', age: 25 })

      const user1 = await service.fetch('user:1')
      expect(user1).toEqual({ name: 'Alice', age: 30 })

      const nonExistent = await service.fetch('user:999')
      expect(nonExistent).toBeNull()

      // Test bulk save via RPC
      const count = await service.bulkSave([
        { key: 'item:1', value: 'first' },
        { key: 'item:2', value: 'second' },
        { key: 'item:3', value: 'third' }
      ])
      expect(count).toBe(3)

      // Test delete via RPC
      const deleted = await service.deleteKey('user:1')
      expect(deleted).toBe(true)

      const deletedUser = await service.fetch('user:1')
      expect(deletedUser).toBeNull()
    })
  })

  describe('Multiple Services via RPC', () => {
    it('should support multiple services with different schemas via RPC', async () => {
      // User service
      class UserService extends RpcTarget {
        private users: Map<string, { id: string; name: string; email: string }> = new Map()
        private idCounter = 0

        createUser(name: string, email: string): { id: string; name: string; email: string } {
          const id = `user-${++this.idCounter}`
          const user = { id, name, email }
          this.users.set(id, user)
          return user
        }

        getUser(id: string): { id: string; name: string; email: string } | null {
          return this.users.get(id) ?? null
        }
      }

      // Auth service
      class AuthService extends RpcTarget {
        private sessions: Map<string, { userId: string; token: string; expiresAt: number }> = new Map()

        login(userId: string): { token: string; expiresAt: number } {
          const token = `token-${Math.random().toString(36).slice(2)}`
          const expiresAt = Date.now() + 3600000
          const session = { userId, token, expiresAt }
          this.sessions.set(token, session)
          return { token, expiresAt }
        }

        validateToken(token: string): boolean {
          const session = this.sessions.get(token)
          return session !== undefined && session.expiresAt > Date.now()
        }

        logout(token: string): boolean {
          return this.sessions.delete(token)
        }
      }

      // Logger service
      class LoggerService extends RpcTarget {
        private logs: Array<{ level: string; message: string; timestamp: number }> = []

        log(level: string, message: string): void {
          this.logs.push({ level, message, timestamp: Date.now() })
        }

        getLogs(level?: string): Array<{ level: string; message: string; timestamp: number }> {
          if (level) {
            return this.logs.filter(log => log.level === level)
          }
          return [...this.logs]
        }

        clear(): void {
          this.logs = []
        }
      }

      // Register all services
      host.registerService({
        id: 'users',
        schema: z.object({ createUser: z.function(), getUser: z.function() }),
        implementation: new UserService()
      })

      host.registerService({
        id: 'auth',
        schema: z.object({ login: z.function(), validateToken: z.function(), logout: z.function() }),
        implementation: new AuthService()
      })

      host.registerService({
        id: 'logger',
        schema: z.object({ log: z.function(), getLogs: z.function(), clear: z.function() }),
        implementation: new LoggerService()
      })

      // Access all services via RPC
      const users = (client as any).users
      const auth = (client as any).auth
      const logger = (client as any).logger

      // Create a user via RPC
      const user = await users.createUser('Alice', 'alice@example.com')
      await logger.log('info', `User created: ${user.id}`)

      // Login via RPC
      const session = await auth.login(user.id)
      await logger.log('info', `User logged in: ${user.id}`)

      // Validate token via RPC
      expect(await auth.validateToken(session.token)).toBe(true)
      expect(await auth.validateToken('invalid-token')).toBe(false)

      // Logout via RPC
      await auth.logout(session.token)
      await logger.log('info', `User logged out: ${user.id}`)

      // Check logs via RPC
      const allLogs = await logger.getLogs()
      expect(allLogs.length).toBe(3)

      const infoLogs = await logger.getLogs('info')
      expect(infoLogs.length).toBe(3)
    })
  })

  describe('Service Replacement via RPC', () => {
    it('should handle service replacement correctly through RPC', async () => {
      // Original service - V1
      class GreetingServiceV1 extends RpcTarget {
        greet(name: string): string {
          return `Hello, ${name}!`
        }
      }

      // Updated service - V2
      class GreetingServiceV2 extends RpcTarget {
        greet(name: string): string {
          return `Welcome, ${name}!`
        }

        farewell(name: string): string {
          return `Goodbye, ${name}!`
        }
      }

      // Register V1
      host.registerService({
        id: 'greeting',
        schema: z.object({ greet: z.function() }),
        implementation: new GreetingServiceV1()
      })

      // Test V1 via RPC
      const greetingV1 = (client as any).greeting
      expect(await greetingV1.greet('Alice')).toBe('Hello, Alice!')

      // Replace with V2
      host.registerService({
        id: 'greeting',
        schema: z.object({ greet: z.function(), farewell: z.function() }),
        implementation: new GreetingServiceV2()
      })

      // Test V2 via RPC (same client reference, but host service changed)
      expect(await greetingV1.greet('Alice')).toBe('Welcome, Alice!')
      expect(await greetingV1.farewell('Alice')).toBe('Goodbye, Alice!')
    })
  })

  describe('Complex Nested Data Types via RPC', () => {
    it('should support services with complex nested data types via RPC', async () => {
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

      class TreeService extends RpcTarget {
        private root: TreeNode | null = null

        createTree(rootValue: unknown): TreeNode {
          this.root = {
            id: 'root',
            value: rootValue,
            children: [],
            metadata: {
              createdAt: Date.now(),
              updatedAt: Date.now(),
              tags: []
            }
          }
          return this.root
        }

        addChild(parentId: string, value: unknown): TreeNode | null {
          const parent = this.findNode(parentId)
          if (!parent) return null

          const child: TreeNode = {
            id: `node-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            value,
            children: [],
            metadata: {
              createdAt: Date.now(),
              updatedAt: Date.now(),
              tags: []
            }
          }
          parent.children.push(child)
          return child
        }

        findNode(id: string): TreeNode | null {
          if (!this.root) return null
          return this.searchTree(this.root, id)
        }

        private searchTree(node: TreeNode, id: string): TreeNode | null {
          if (node.id === id) return node
          for (const child of node.children) {
            const found = this.searchTree(child, id)
            if (found) return found
          }
          return null
        }

        getDepth(): number {
          if (!this.root) return 0
          return this.calculateDepth(this.root)
        }

        private calculateDepth(node: TreeNode): number {
          if (node.children.length === 0) return 1
          return 1 + Math.max(...node.children.map(c => this.calculateDepth(c)))
        }

        addTag(nodeId: string, tag: string): boolean {
          const node = this.findNode(nodeId)
          if (!node || !node.metadata) return false
          node.metadata.tags.push(tag)
          node.metadata.updatedAt = Date.now()
          return true
        }

        getTags(nodeId: string): string[] {
          const node = this.findNode(nodeId)
          return node?.metadata?.tags ?? []
        }
      }

      host.registerService({
        id: 'tree',
        schema: z.object({
          createTree: z.function(),
          addChild: z.function(),
          findNode: z.function(),
          getDepth: z.function(),
          addTag: z.function(),
          getTags: z.function()
        }),
        implementation: new TreeService()
      })

      const tree = (client as any).tree

      // Build tree via RPC
      const root = await tree.createTree({ name: 'Root' })
      expect(root.id).toBe('root')
      expect(root.children).toHaveLength(0)

      const child1 = await tree.addChild('root', { name: 'Child 1' })
      const child2 = await tree.addChild('root', { name: 'Child 2' })

      const rootNode = await tree.findNode('root')
      expect(rootNode.children).toHaveLength(2)

      // Add grandchildren via RPC
      await tree.addChild(child1.id, { name: 'Grandchild 1' })
      await tree.addChild(child1.id, { name: 'Grandchild 2' })

      expect(await tree.getDepth()).toBe(3)

      // Test metadata operations via RPC
      await tree.addTag('root', 'important')
      await tree.addTag('root', 'primary')
      expect(await tree.getTags('root')).toEqual(['important', 'primary'])

      await tree.addTag(child1.id, 'category:a')
      expect(await tree.getTags(child1.id)).toEqual(['category:a'])
    })
  })

  describe('Error Handling via RPC', () => {
    it('should support services with error handling via RPC', async () => {
      class ValidationService extends RpcTarget {
        validateEmail(email: string): { valid: boolean; error?: string } {
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

        validatePassword(password: string): { valid: boolean; errors: string[] } {
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

        validateAge(age: unknown): { valid: boolean; value?: number; error?: string } {
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
      }

      host.registerService({
        id: 'validation',
        schema: z.object({
          validateEmail: z.function(),
          validatePassword: z.function(),
          validateAge: z.function()
        }),
        implementation: new ValidationService()
      })

      const validation = (client as any).validation

      // Test email validation via RPC
      expect(await validation.validateEmail('')).toEqual({ valid: false, error: 'Email is required' })
      expect(await validation.validateEmail('invalid')).toEqual({ valid: false, error: 'Invalid email format' })
      expect(await validation.validateEmail('user@example.com')).toEqual({ valid: true })

      // Test password validation via RPC
      const weakPassword = await validation.validatePassword('weak')
      expect(weakPassword.valid).toBe(false)
      expect(weakPassword.errors).toContain('Password must be at least 8 characters')
      expect(weakPassword.errors).toContain('Password must contain uppercase letter')
      expect(weakPassword.errors).toContain('Password must contain a number')

      const strongPassword = await validation.validatePassword('StrongPass123')
      expect(strongPassword.valid).toBe(true)
      expect(strongPassword.errors).toHaveLength(0)

      // Test age validation via RPC
      expect(await validation.validateAge('not a number')).toEqual({ valid: false, error: 'Age must be a number' })
      expect(await validation.validateAge(25.5)).toEqual({ valid: false, error: 'Age must be an integer' })
      expect(await validation.validateAge(-5)).toEqual({ valid: false, error: 'Age must be between 0 and 150' })
      expect(await validation.validateAge(25)).toEqual({ valid: true, value: 25 })
    })
  })

  describe('Config and Dynamic Registration via RPC', () => {
    it('should support services registered via config and dynamic registration via RPC', async () => {
      // Close default channel
      host.disconnect()
      channel.port1.close()
      channel.port2.close()

      // Pre-configured service
      class ConfigService extends RpcTarget {
        private config: Record<string, string> = {
          apiUrl: 'https://api.example.com',
          version: '1.0.0'
        }

        get(key: string): string | null {
          return this.config[key] ?? null
        }

        set(key: string, value: string): void {
          this.config[key] = value
        }
      }

      // Create new channel with customServices
      const customServices = new Map<string, () => RpcTarget>([
        ['config', () => new ConfigService()]
      ])

      channel = new MessageChannel()
      host = createMainRpcHost(channel.port1, {
        basePath: '/demo',
        customServices
      })
      client = newMessagePortRpcSession<SandboxMainService>(channel.port2, {})
      channel.port1.start()
      channel.port2.start()

      // Verify config service is available via RPC
      const config = (client as any).config
      expect(await config.get('apiUrl')).toBe('https://api.example.com')

      // Dynamically register another service
      class RuntimeService extends RpcTarget {
        private startTime = Date.now()
        private pid = 'sandbox-1'

        getUptime(): number {
          return Date.now() - this.startTime
        }

        getInfo(): { startTime: number; pid: string } {
          return { startTime: this.startTime, pid: this.pid }
        }
      }

      host.registerService({
        id: 'runtime',
        schema: z.object({ getUptime: z.function(), getInfo: z.function() }),
        implementation: new RuntimeService()
      })

      // Both services should work via RPC
      await config.set('newKey', 'newValue')
      expect(await config.get('newKey')).toBe('newValue')

      const runtime = (client as any).runtime
      expect(await runtime.getUptime()).toBeGreaterThanOrEqual(0)
      const info = await runtime.getInfo()
      expect(info.pid).toBe('sandbox-1')
    })
  })

  describe('State Isolation via RPC', () => {
    it('should maintain service state isolation between hosts via RPC', async () => {
      // Create two separate channels and hosts
      const channel1 = new MessageChannel()
      const channel2 = new MessageChannel()

      const host1 = createMainRpcHost(channel1.port1, { basePath: '/demo1' })
      const host2 = createMainRpcHost(channel2.port1, { basePath: '/demo2' })

      const client1 = newMessagePortRpcSession<SandboxMainService>(channel1.port2, {})
      const client2 = newMessagePortRpcSession<SandboxMainService>(channel2.port2, {})

      channel1.port1.start()
      channel1.port2.start()
      channel2.port1.start()
      channel2.port2.start()

      class CounterService extends RpcTarget {
        private count = 0

        increment(): number {
          return ++this.count
        }

        decrement(): number {
          return --this.count
        }

        getCount(): number {
          return this.count
        }

        reset(): void {
          this.count = 0
        }
      }

      // Register counter service on both hosts
      host1.registerService({
        id: 'counter',
        schema: z.object({ increment: z.function(), decrement: z.function(), getCount: z.function(), reset: z.function() }),
        implementation: new CounterService()
      })

      host2.registerService({
        id: 'counter',
        schema: z.object({ increment: z.function(), decrement: z.function(), getCount: z.function(), reset: z.function() }),
        implementation: new CounterService()
      })

      // Operate on counter1 via RPC
      const counter1 = (client1 as any).counter
      await counter1.increment()
      await counter1.increment()
      await counter1.increment()
      expect(await counter1.getCount()).toBe(3)

      // Counter2 should be independent via RPC
      const counter2 = (client2 as any).counter
      expect(await counter2.getCount()).toBe(0)
      await counter2.increment()
      expect(await counter2.getCount()).toBe(1)

      // Counter1 should still be 3
      expect(await counter1.getCount()).toBe(3)

      // Cleanup
      host1.disconnect()
      host2.disconnect()
      channel1.port1.close()
      channel1.port2.close()
      channel2.port1.close()
      channel2.port2.close()
    })
  })

  describe('RPC Error Propagation', () => {
    it('should propagate errors from service methods through RPC', async () => {
      class ErrorService extends RpcTarget {
        throwSync(): never {
          throw new Error('Sync error from service')
        }

        async throwAsync(): Promise<never> {
          await new Promise(resolve => setTimeout(resolve, 10))
          throw new Error('Async error from service')
        }

        maybeThrow(shouldThrow: boolean): string {
          if (shouldThrow) {
            throw new Error('Conditional error')
          }
          return 'success'
        }
      }

      host.registerService({
        id: 'errorService',
        schema: z.object({
          throwSync: z.function(),
          throwAsync: z.function(),
          maybeThrow: z.function()
        }),
        implementation: new ErrorService()
      })

      const errorService = (client as any).errorService

      // Test sync error via RPC
      await expect(errorService.throwSync()).rejects.toThrow()

      // Test async error via RPC
      await expect(errorService.throwAsync()).rejects.toThrow()

      // Test conditional error via RPC
      expect(await errorService.maybeThrow(false)).toBe('success')
      await expect(errorService.maybeThrow(true)).rejects.toThrow()
    })
  })

  describe('Large Data Transfer via RPC', () => {
    it('should handle large data transfer through RPC', async () => {
      class DataService extends RpcTarget {
        generateLargeArray(size: number): number[] {
          return Array.from({ length: size }, (_, i) => i)
        }

        generateLargeObject(size: number): Record<string, string> {
          const obj: Record<string, string> = {}
          for (let i = 0; i < size; i++) {
            obj[`key${i}`] = `value${i}_${'x'.repeat(100)}`
          }
          return obj
        }

        echoData(data: unknown): unknown {
          return data
        }
      }

      host.registerService({
        id: 'dataService',
        schema: z.object({
          generateLargeArray: z.function(),
          generateLargeObject: z.function(),
          echoData: z.function()
        }),
        implementation: new DataService()
      })

      const dataService = (client as any).dataService

      // Test large array via RPC
      const largeArray = await dataService.generateLargeArray(1000)
      expect(largeArray.length).toBe(1000)
      expect(largeArray[0]).toBe(0)
      expect(largeArray[999]).toBe(999)

      // Test large object via RPC
      const largeObject = await dataService.generateLargeObject(100)
      expect(Object.keys(largeObject).length).toBe(100)
      expect(largeObject.key0).toContain('value0')

      // Test echo with nested data via RPC
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
      const echoed = await dataService.echoData(nestedData)
      expect(echoed).toEqual(nestedData)
    })
  })
})
