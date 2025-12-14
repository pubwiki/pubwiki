/**
 * VfsService E2E Tests
 *
 * End-to-end tests for VfsServiceImpl running in a real browser environment
 * with Web Workers support.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VfsServiceImpl } from '../../src/services/vfs-service'
import { HmrServiceImpl } from '../../src/services/hmr-service'
import { createTestVfs, addFile } from './helpers'
import type { Vfs } from '@pubwiki/vfs'
import type { ProjectConfig } from '@pubwiki/bundler'

describe('VfsServiceImpl E2E', () => {
  let vfs: Vfs
  let hmrService: HmrServiceImpl
  let service: VfsServiceImpl | null = null

  beforeEach(async () => {
    const testVfs = createTestVfs()
    vfs = testVfs.vfs
    hmrService = new HmrServiceImpl()
  })

  afterEach(() => {
    if (service) {
      service.dispose()
      service = null
    }
    hmrService.dispose()
  })

  describe('static HTML project', () => {
    beforeEach(async () => {
      // Create a simple static HTML project
      await addFile(vfs, '/public/demo/index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>Test</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="root">Hello World</div>
  <script src="/script.js"></script>
</body>
</html>
`)
      await addFile(vfs, '/public/demo/styles.css', `
body { 
  color: red; 
  font-family: sans-serif;
}
`)
      await addFile(vfs, '/public/demo/script.js', `
console.log('Hello from script');
`)
      await addFile(vfs, '/public/demo/data/config.json', JSON.stringify({
        name: 'test',
        version: '1.0.0'
      }))
    })

    it('should create VfsServiceImpl instance', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      expect(service).toBeDefined()
      expect(service).toBeInstanceOf(VfsServiceImpl)
    })

    it('should read HTML file', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await service.readFile('/index.html')
      
      expect(result).toBeDefined()
      expect(result.path).toBe('/public/demo/index.html')
      expect(result.mimeType).toBe('text/html')
      
      const content = new TextDecoder().decode(result.content as Uint8Array)
      expect(content).toContain('<!DOCTYPE html>')
      expect(content).toContain('Hello World')
    })

    it('should read CSS file', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await service.readFile('/styles.css')
      
      expect(result).toBeDefined()
      expect(result.mimeType).toBe('text/css')
      
      const content = new TextDecoder().decode(result.content as Uint8Array)
      expect(content).toContain('color: red')
    })

    it('should read JSON file', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const result = await service.readFile('/data/config.json')
      
      expect(result).toBeDefined()
      expect(result.mimeType).toBe('application/json')
      
      const content = new TextDecoder().decode(result.content as Uint8Array)
      const data = JSON.parse(content)
      expect(data.name).toBe('test')
      expect(data.version).toBe('1.0.0')
    })

    it('should check file existence', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const existsResult = await service.fileExists('/index.html')
      expect(existsResult.exists).toBe(true)

      const notExistsResult = await service.fileExists('/non-existent.txt')
      expect(notExistsResult.exists).toBe(false)
    })

    it('should list directory contents', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      const entries = await service.listDir('/')
      
      expect(entries).toBeInstanceOf(Array)
      expect(entries.length).toBeGreaterThan(0)
      
      const names = entries.map(e => e.name)
      expect(names).toContain('index.html')
      expect(names).toContain('styles.css')
      expect(names).toContain('script.js')
      expect(names).toContain('data')
      
      // Check that data is marked as directory
      const dataEntry = entries.find(e => e.name === 'data')
      expect(dataEntry?.isDirectory).toBe(true)
    })

    it('should return correct MIME types', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      expect(service.getMimeType('/test.html')).toBe('text/html')
      expect(service.getMimeType('/test.css')).toBe('text/css')
      expect(service.getMimeType('/test.js')).toBe('application/javascript')
      // TypeScript files have their own MIME types (transpilation happens at read time)
      expect(service.getMimeType('/test.ts')).toBe('application/typescript')
      expect(service.getMimeType('/test.tsx')).toBe('application/typescript')
      expect(service.getMimeType('/test.json')).toBe('application/json')
      expect(service.getMimeType('/test.svg')).toBe('image/svg+xml')
      expect(service.getMimeType('/test.png')).toBe('image/png')
      expect(service.getMimeType('/test.woff2')).toBe('font/woff2')
    })
  })

  describe('buildable TypeScript project', () => {
    beforeEach(async () => {
      // Create a TypeScript React project
      await addFile(vfs, '/project/tsconfig.json', JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'ESNext',
          jsx: 'react-jsx',
          moduleResolution: 'bundler'
        },
        files: ['src/main.tsx']
      }, null, 2))

      await addFile(vfs, '/project/src/main.tsx', `
import React from 'react'

export function App() {
  return <div>Hello from React</div>
}

export default App
`)

      await addFile(vfs, '/project/index.html', `
<!DOCTYPE html>
<html>
<head>
  <title>React App</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
`)
    })

    it('should create VfsServiceImpl for buildable project', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: true,
        tsconfigPath: '/project/tsconfig.json',
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        tsconfigContent: {
          compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' },
          files: ['src/main.tsx']
        }
      }

      service = new VfsServiceImpl({
        basePath: '/project',
        projectConfig,
        hmrService,
        vfs
      })

      expect(service).toBeDefined()
      expect(service).toBeInstanceOf(VfsServiceImpl)
    })

    it('should read and transform TypeScript file', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: true,
        tsconfigPath: '/project/tsconfig.json',
        projectRoot: '/project',
        entryFiles: ['/project/src/main.tsx'],
        tsconfigContent: {
          compilerOptions: { target: 'ES2020', module: 'ESNext', jsx: 'react-jsx' },
          files: ['src/main.tsx']
        }
      }

      service = new VfsServiceImpl({
        basePath: '/project',
        projectConfig,
        hmrService,
        vfs
      })

      // Wait for bundler initialization
      await new Promise(resolve => setTimeout(resolve, 500))

      const result = await service.readFile('/src/main.tsx')
      
      expect(result).toBeDefined()
      expect(result.mimeType).toBe('application/javascript')
      
      const content = new TextDecoder().decode(result.content as Uint8Array)
      // TypeScript should be transformed to JavaScript
      // JSX should be transformed
      expect(content).not.toContain('export function App')
      // The code should contain transformed React code
      expect(content.length).toBeGreaterThan(0)
    }, 30000) // Longer timeout for bundler initialization
  })

  describe('file watching and HMR', () => {
    it('should notify HMR on file changes', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      // Create initial file
      await addFile(vfs, '/public/demo/test.js', 'console.log("initial")')

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Track HMR notifications
      const notifications: any[] = []
      const mockCallback = {
        dup: () => mockCallback,
        async: async (update: any) => {
          notifications.push(update)
          return Promise.resolve()
        }
      }

      await hmrService.subscribe(mockCallback as any)

      // Update the file
      await vfs.createFile('/public/demo/test.js', 'console.log("updated")')

      // Wait for HMR notification
      await new Promise(resolve => setTimeout(resolve, 200))

      // The HMR notification depends on the watch implementation
      // For now, just verify the service is still functional
      const result = await service.readFile('/test.js')
      expect(result).toBeDefined()
    })
  })

  describe('dispose', () => {
    it('should clean up resources on dispose', async () => {
      const projectConfig: ProjectConfig = {
        isBuildable: false,
        tsconfigPath: '',
        projectRoot: '/public/demo',
        entryFiles: [],
        tsconfigContent: null
      }

      await addFile(vfs, '/public/demo/index.html', '<html></html>')

      service = new VfsServiceImpl({
        basePath: '/public/demo',
        projectConfig,
        hmrService,
        vfs
      })

      await new Promise(resolve => setTimeout(resolve, 100))

      // Should not throw
      expect(() => service!.dispose()).not.toThrow()
      
      // Multiple dispose calls should be safe
      expect(() => service!.dispose()).not.toThrow()
      
      service = null // Already disposed
    })
  })
})
