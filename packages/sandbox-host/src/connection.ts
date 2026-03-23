/**
 * Sandbox Connection
 *
 * Manages the connection between main site and sandbox iframe.
 * Creates and manages two independent RPC channels:
 * 1. VFS Channel - for Service Worker (file access)
 * 2. Main Channel - for sandbox main page (HMR)
 *
 * Integrates build and file watching:
 * - Builds project on initialization
 * - Sets up file watching, notifying HMR on changes
 */

import type { HmrUpdate } from '@pubwiki/sandbox-service'
import type { ICustomService } from '@pubwiki/sandbox-service'
import type {
  SandboxConnectionConfig,
  SandboxConnection,
  MainRpcHost,
  VfsRpcHost
} from './types'
import type { Vfs } from '@pubwiki/vfs'
import {
  createVfsRpcChannel,
  createMainRpcChannel,
  type VfsRpcHostConfigExt,
  type MainRpcHostConfigExt
} from './rpc-host'

/**
 * Extended sandbox connection config with injected dependencies
 */
export interface SandboxConnectionConfigExt extends SandboxConnectionConfig {
  /** VFS instance */
  vfs: Vfs
}

/**
 * Create a sandbox connection
 *
 * This creates two independent RPC channels and integrates bundler:
 * 1. VFS RPC channel - for Service Worker
 * 2. Main RPC channel - for sandbox main page
 * 3. Build project + setup file watching
 *
 * The connection automatically initializes when the sandbox sends SANDBOX_READY.
 *
 * @param config - Connection configuration
 * @returns Sandbox connection instance
 */
export function createSandboxConnection(
  config: SandboxConnectionConfigExt
): SandboxConnection {
  const {
    iframe,
    basePath,
    projectConfig,
    targetOrigin,
    entryFile,
    initialPath,
    customServices,
    vfs,
    onLog,
    onUrlChange
  } = config

  const id = `sandbox-conn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let connected = false
  let initPromise: Promise<boolean> | null = null
  let initResolve: ((value: boolean) => void) | null = null

  // RPC hosts
  let vfsRpcHost: VfsRpcHost | null = null
  let mainRpcHost: MainRpcHost | null = null

  // Pending onLog callback (set before mainRpcHost is ready)
  let pendingOnLogCallback = onLog ?? null

  // Pending onUrlChange callback (set before mainRpcHost is ready)
  const pendingOnUrlChangeCallback = onUrlChange ?? null

  // File watching cleanup
  let stopFileWatching: (() => void) | null = null

  // Message handler for VFS port requests (SW reconnection)
  const handleVfsPortRequest = (event: MessageEvent) => {
    const sandboxOrigin = new URL(targetOrigin).origin
    if (event.origin !== sandboxOrigin) return

    if (event.data?.type === 'REQUEST_VFS_PORT') {
      console.log(`[SandboxConnection:${id}] SW requesting new VFS port for reconnection`)

      if (!iframe.contentWindow || !vfsRpcHost) {
        console.warn(`[SandboxConnection:${id}] Cannot send VFS port: not ready`)
        return
      }

      // VfsRpcHost handles port creation and rebinding internally
      const clientPort = vfsRpcHost.createNewPort()

      iframe.contentWindow.postMessage(
        { type: 'VFS_PORT_RESPONSE' },
        targetOrigin,
        [clientPort]
      )

      console.log(`[SandboxConnection:${id}] Sent new VFS port to sandbox`)
    }
  }

  /**
   * Internal initialization - called when sandbox is ready
   */
  async function doInitialize(): Promise<boolean> {
    if (!iframe.contentWindow) {
      console.error(`[SandboxConnection:${id}] No iframe contentWindow`)
      return false
    }

    try {
      // 1. Create Main RPC channel first to get HMR service
      const mainConfig: MainRpcHostConfigExt = {
        basePath,
        customServices
      }

      const mainChannel = createMainRpcChannel(mainConfig)
      mainRpcHost = mainChannel.host

      const hmrService = mainRpcHost.getHmrService?.()
      if (!hmrService) {
        throw new Error('[SandboxConnection] Failed to get HMR service')
      }

      // Set up onLog callback if provided
      if (pendingOnLogCallback) {
        hmrService.setOnLogCallback(pendingOnLogCallback)
      }

      // Set up onUrlChange callback if provided
      if (pendingOnUrlChangeCallback) {
        hmrService.setOnUrlChangeCallback(pendingOnUrlChangeCallback)
      }

      // 2. Create VFS RPC channel with HMR service
      const vfsConfig: VfsRpcHostConfigExt = {
        basePath,
        projectConfig,
        hmrService,
        vfs
      }

      const vfsChannel = createVfsRpcChannel(vfsConfig)
      vfsRpcHost = vfsChannel.host

      // 3. Send initialization message with both ports
      iframe.contentWindow.postMessage(
        {
          type: 'sandbox-init',
          basePath,
          entryFile,
          initialPath
        },
        targetOrigin,
        [mainChannel.clientPort, vfsChannel.clientPort]
      )

      // 4. Start listening for VFS port requests (for SW reconnection)
      window.addEventListener('message', handleVfsPortRequest)

      connected = true
      console.log(`[SandboxConnection:${id}] Initialized successfully`)

      return true
    } catch (error) {
      console.error(`[SandboxConnection:${id}] Initialization failed:`, error)
      return false
    }
  }

  // Handler for SANDBOX_READY message
  const handleSandboxReady = async (event: MessageEvent) => {
    const sandboxOrigin = new URL(targetOrigin).origin
    if (event.origin !== sandboxOrigin) return
    if (event.data?.type !== 'SANDBOX_READY') return

    console.log(`[SandboxConnection:${id}] Sandbox ready, initializing...`)

    // Remove listener - only initialize once
    window.removeEventListener('message', handleSandboxReady)

    const success = await doInitialize()
    
    if (initResolve) {
      initResolve(success)
    }
  }

  // Start listening for SANDBOX_READY immediately
  window.addEventListener('message', handleSandboxReady)

  console.log(`[SandboxConnection:${id}] Created for basePath: ${basePath}, waiting for sandbox ready...`)

  return {
    id,

    get isConnected() {
      return connected
    },

    getBundlerService() {
      return vfsRpcHost?.getBundlerService() ?? null
    },

    waitForReady(): Promise<boolean> {
      if (connected) {
        return Promise.resolve(true)
      }
      
      if (!initPromise) {
        initPromise = new Promise<boolean>((resolve) => {
          initResolve = resolve
        })
      }
      
      return initPromise
    },

    reload(): void {
      console.log(`[SandboxConnection:${id}] Manual reload triggered`)

      const hmrService = mainRpcHost?.getHmrService?.()
      if (hmrService) {
        const update: HmrUpdate = {
          type: 'update',
          timestamp: Date.now(),
          path: '__manual_reload__' // Special marker for manual refresh
        }
        hmrService.notifyUpdate(update)
      } else {
        console.warn(`[SandboxConnection:${id}] Cannot reload: HMR service not available`)
      }
    },

    addCustomService(id: string, service: ICustomService): void {
      if (!mainRpcHost) {
        console.error(`[SandboxConnection:${id}] Cannot add service: not initialized`)
        return
      }
      
      mainRpcHost.registerService(id, service)
      console.log(`[SandboxConnection:${id}] Added custom service: ${id}`)
    },

    getLogs() {
      const hmrService = mainRpcHost?.getHmrService()
      return hmrService?.getLogs() ?? []
    },

    clearLogs() {
      const hmrService = mainRpcHost?.getHmrService()
      hmrService?.clearLogs()
    },

    setOnLogCallback(callback) {
      pendingOnLogCallback = callback
      const hmrService = mainRpcHost?.getHmrService()
      hmrService?.setOnLogCallback(callback)
    },

    disconnect(): void {
      // Remove SANDBOX_READY listener if still attached
      window.removeEventListener('message', handleSandboxReady)

      // Stop file watching
      if (stopFileWatching) {
        stopFileWatching()
        stopFileWatching = null
      }

      // Remove message listeners
      window.removeEventListener('message', handleVfsPortRequest)

      // Disconnect RPC hosts
      if (vfsRpcHost) {
        vfsRpcHost.disconnect()
        vfsRpcHost = null
      }

      if (mainRpcHost) {
        mainRpcHost.disconnect()
        mainRpcHost = null
      }

      connected = false

      console.log(`[SandboxConnection:${id}] Disconnected`)
    }
  }
}
