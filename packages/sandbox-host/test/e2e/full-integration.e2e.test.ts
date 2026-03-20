/**
 * Full Integration E2E Tests
 *
 * End-to-end tests that exercise the complete sandbox-host functionality
 * including VFS, RPC hosts, connection management, and custom services.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createSandboxConnection } from '../../src/connection'
import { createMainRpcChannel, createVfsRpcChannel } from '../../src/rpc-host'
import { HmrServiceImpl } from '../../src/services/hmr-service'
import { createTestVfs, addFile, createRealIframe, removeIframe } from './helpers'
import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'
import type { HmrUpdate } from '@pubwiki/sandbox-service'
import type { ICustomService, ServiceDefinition } from '../../src/types'

describe('Full Integration E2E', () => {
  let vfs: Vfs

  beforeEach(async () => {
    const testVfs = createTestVfs()
    vfs = testVfs.vfs
  })

  describe('Static HTML Project Workflow', () => {
    let iframe: HTMLIFrameElement | null = null
    let connection: ReturnType<typeof createSandboxConnection> | null = null

    beforeEach(async () => {
      // Create a complete static website
      await addFile(vfs, '/website/index.html', `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Website</title>
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">Home</a>
      <a href="/about.html">About</a>
    </nav>
  </header>
  <main id="content">
    <h1>Welcome</h1>
    <p>This is a test website.</p>
  </main>
  <footer>
    <p>&copy; 2025 Test</p>
  </footer>
  <script src="/scripts/main.js"></script>
</body>
</html>
`)

      await addFile(vfs, '/website/about.html', `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>About</title>
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <h1>About Us</h1>
  <p>Learn more about us.</p>
</body>
</html>
`)

      await addFile(vfs, '/website/styles/main.css', `
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.6;
  color: #333;
}

header {
  background: #0066cc;
  color: white;
  padding: 1rem;
}

nav a {
  color: white;
  margin-right: 1rem;
}

main {
  padding: 2rem;
}

footer {
  background: #f5f5f5;
  padding: 1rem;
  text-align: center;
}
`)

      await addFile(vfs, '/website/scripts/main.js', `
console.log('Main script loaded');

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready');
  
  // Add some interactivity
  const content = document.getElementById('content');
  if (content) {
    content.addEventListener('click', () => {
      console.log('Content clicked');
    });
  }
});
`)

      await addFile(vfs, '/website/data/config.json', JSON.stringify({
        siteName: 'My Website',
        version: '1.0.0',
        features: ['responsive', 'fast', 'accessible']
      }, null, 2))
    })

    afterEach(() => {
      if (connection) {
        connection.disconnect()
        connection = null
      }
      if (iframe) {
        removeIframe(iframe)
        iframe = null
      }
    })

    it('should create connection for static website', async () => {
      iframe = createRealIframe()

      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/website',
        entryFiles: [],
        tsconfigContent: null
      }

      connection = createSandboxConnection({
        iframe,
        basePath: '/website',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Connection starts as not connected, waits for SANDBOX_READY message
      expect(connection.isConnected).toBe(false)
    })

    it('should support adding custom services to connection', async () => {
      iframe = createRealIframe()

      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/website',
        entryFiles: [],
        tsconfigContent: null
      }

      connection = createSandboxConnection({
        iframe,
        basePath: '/website',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Wait for ready (or timeout since we don't have a real sandbox)
      // Note: In real scenarios, this would wait for SANDBOX_READY message
      
      // Add an analytics service using ICustomService interface
      const events: Array<{ name: string; data: unknown; timestamp: number }> = []
      
      const analyticsService: ICustomService = {
        async call(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
          const action = inputs.action as string
          if (action === 'track') {
            events.push({ name: inputs.name as string, data: inputs.data, timestamp: Date.now() })
            return { success: true }
          } else if (action === 'getEvents') {
            return { events: [...events] }
          } else if (action === 'clear') {
            events.length = 0
            return { success: true }
          }
          return {}
        },
        async getDefinition(): Promise<ServiceDefinition> {
          return {
            name: 'analytics',
            namespace: 'app',
            identifier: 'app:analytics',
            kind: 'ACTION',
            description: 'Analytics tracking service',
            inputs: { type: 'object' },
            outputs: { type: 'object' }
          }
        }
      }

      connection.addCustomService('analytics', analyticsService)

      // Service should be added successfully
      // (We can't verify directly since mainRpcHost is internal)
    })
  })

  describe('TypeScript React Project Workflow', () => {
    let iframe: HTMLIFrameElement | null = null
    let connection: ReturnType<typeof createSandboxConnection> | null = null

    beforeEach(async () => {
      // Create a React TypeScript project
      await addFile(vfs, '/react-app/tsconfig.json', JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          jsx: 'react-jsx',
          moduleResolution: 'bundler',
          strict: true
        },
        files: ['src/main.tsx']
      }, null, 2))

      await addFile(vfs, '/react-app/index.html', `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`)

      await addFile(vfs, '/react-app/src/main.tsx', `
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const root = createRoot(document.getElementById('root')!)
root.render(<App />)
`)

      await addFile(vfs, '/react-app/src/App.tsx', `
import React, { useState } from 'react'
import { Counter } from './components/Counter'
import { Header } from './components/Header'

export default function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  return (
    <div className={\`app \${theme}\`}>
      <Header onToggleTheme={() => setTheme(t => t === 'light' ? 'dark' : 'light')} />
      <main>
        <h1>Welcome to React App</h1>
        <Counter />
      </main>
    </div>
  )
}
`)

      await addFile(vfs, '/react-app/src/components/Counter.tsx', `
import React, { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)

  return (
    <div className="counter">
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>Increment</button>
      <button onClick={() => setCount(c => c - 1)}>Decrement</button>
      <button onClick={() => setCount(0)}>Reset</button>
    </div>
  )
}
`)

      await addFile(vfs, '/react-app/src/components/Header.tsx', `
import React from 'react'

interface HeaderProps {
  onToggleTheme: () => void
}

export function Header({ onToggleTheme }: HeaderProps) {
  return (
    <header>
      <h1>My App</h1>
      <button onClick={onToggleTheme}>Toggle Theme</button>
    </header>
  )
}
`)
    })

    afterEach(() => {
      if (connection) {
        connection.disconnect()
        connection = null
      }
      if (iframe) {
        removeIframe(iframe)
        iframe = null
      }
    })

    it('should create connection for TypeScript React project', async () => {
      iframe = createRealIframe()

      const projectConfig: ProjectConfig = {
        isBuildable: true,
        tsconfigPath: '/react-app/tsconfig.json',
        projectRoot: '/react-app',
        entryFiles: ['/react-app/src/main.tsx'],
        tsconfigContent: {
          compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' },
          files: ['src/main.tsx']
        }
      }

      connection = createSandboxConnection({
        iframe,
        basePath: '/react-app',
        vfs,
        projectConfig,
        targetOrigin: '*',
        entryFile: '/index.html'
      })

      // Connection starts as not connected, waits for SANDBOX_READY message
      expect(connection.isConnected).toBe(false)
    }, 30000)
  })

  describe('HMR Service Integration', () => {
    it('should create HMR service and handle subscriptions', async () => {
      const hmrService = new HmrServiceImpl()

      // Track updates
      const updates: HmrUpdate[] = []
      
      // Create a proper mock callback that can be invoked
      const mockCallback = async (update: HmrUpdate) => {
        updates.push(update)
      }
      // Add the dup method to the callback
      const callbackObj = Object.assign(mockCallback, {
        dup: () => callbackObj,
        async: mockCallback
      })

      const subscription = await hmrService.subscribe(callbackObj as unknown as Parameters<typeof hmrService.subscribe>[0])
      expect(subscription.id).toMatch(/^hmr-/)

      // Notify update
      hmrService.notifyUpdate({
        type: 'update',
        timestamp: Date.now(),
        path: '/src/App.tsx',
        affectedModules: ['/src/App.tsx']
      })

      // Wait for notification
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(updates.length).toBe(1)
      expect(updates[0].path).toBe('/src/App.tsx')

      // Unsubscribe
      await hmrService.unsubscribe(subscription.id)

      // New updates should not be received
      hmrService.notifyUpdate({
        type: 'update',
        timestamp: Date.now(),
        path: '/src/Counter.tsx'
      })

      await new Promise(resolve => setTimeout(resolve, 50))

      expect(updates.length).toBe(1) // Still 1

      hmrService.dispose()
    })
  })

  describe('VFS and Main RPC Channels', () => {
    it('should create both channels for a connection', async () => {
      const hmrService = new HmrServiceImpl()

      await addFile(vfs, '/demo/index.html', '<html></html>')

      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      // Create VFS channel
      const vfsChannel = createVfsRpcChannel({
        basePath: '/demo',
        vfs,
        projectConfig,
        hmrService
      })

      // Create Main channel
      const mainChannel = createMainRpcChannel({
        basePath: '/demo'
      })

      expect(vfsChannel.host).toBeDefined()
      expect(vfsChannel.clientPort).toBeInstanceOf(MessagePort)
      expect(mainChannel.host).toBeDefined()
      expect(mainChannel.clientPort).toBeInstanceOf(MessagePort)

      // Clean up
      vfsChannel.host.disconnect()
      mainChannel.host.disconnect()
      hmrService.dispose()
    })
  })
})
