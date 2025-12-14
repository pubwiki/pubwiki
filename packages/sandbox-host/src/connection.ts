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
import type {
  SandboxConnectionConfig,
  SandboxConnection,
  ServiceDefinition,
  VfsRpcHost,
  MainRpcHost
} from './types'
import type { Vfs } from '@pubwiki/vfs'
import type { z } from 'zod/v4'
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
    customServices,
    vfs
  } = config

  const id = `sandbox-conn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  let connected = false

  // RPC hosts
  let vfsRpcHost: VfsRpcHost | null = null
  let mainRpcHost: MainRpcHost | null = null

  // Additional VFS hosts for SW reconnection
  const additionalVfsHosts: VfsRpcHost[] = []

  // File watching cleanup
  let stopFileWatching: (() => void) | null = null

  // Message handler for VFS port requests (SW reconnection)
  const handleVfsPortRequest = (event: MessageEvent) => {
    const sandboxOrigin = new URL(targetOrigin).origin
    if (event.origin !== sandboxOrigin) return

    if (event.data?.type === 'REQUEST_VFS_PORT') {
      console.log(`[SandboxConnection:${id}] SW requesting new VFS port for reconnection`)

      if (!iframe.contentWindow) {
        console.warn(`[SandboxConnection:${id}] Cannot send VFS port: no contentWindow`)
        return
      }

      if (!mainRpcHost) {
        console.warn(`[SandboxConnection:${id}] Main RPC Host not ready`)
        return
      }

      // Create a new VFS channel for the reconnecting SW
      const vfsConfig: VfsRpcHostConfigExt = {
        basePath,
        projectConfig,
        hmrService: mainRpcHost.getHmrService(),
        vfs
      }

      const newVfsChannel = createVfsRpcChannel(vfsConfig)
      additionalVfsHosts.push(newVfsChannel.host)

      iframe.contentWindow.postMessage(
        { type: 'VFS_PORT_RESPONSE' },
        targetOrigin,
        [newVfsChannel.clientPort]
      )

      console.log(`[SandboxConnection:${id}] Sent new VFS port to sandbox`)
    }
  }

  console.log(`[SandboxConnection:${id}] Created for basePath: ${basePath}`)

  return {
    id,

    get isConnected() {
      return connected
    },

    async initialize(entryFile: string): Promise<boolean> {
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

        // 2. Create VFS RPC channel with HMR service
        const vfsConfig: VfsRpcHostConfigExt = {
          basePath,
          projectConfig,
          hmrService,
          vfs
        }

        const vfsChannel = createVfsRpcChannel(vfsConfig)
        vfsRpcHost = vfsChannel.host

        // 4. Send initialization message with both ports
        iframe.contentWindow.postMessage(
          {
            type: 'sandbox-init',
            basePath,
            entryFile
          },
          targetOrigin,
          [mainChannel.clientPort, vfsChannel.clientPort]
        )

        // 5. Start listening for VFS port requests (for SW reconnection)
        window.addEventListener('message', handleVfsPortRequest)

        connected = true
        console.log(`[SandboxConnection:${id}] Initialized successfully`)

        return true
      } catch (error) {
        console.error(`[SandboxConnection:${id}] Initialization failed:`, error)
        return false
      }
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

    addCustomService<T extends z.ZodType>(definition: ServiceDefinition<T>): void {
      if (!mainRpcHost) {
        console.error(`[SandboxConnection:${id}] Cannot add service: not initialized`)
        return
      }
      
      mainRpcHost.registerService(definition)
      console.log(`[SandboxConnection:${id}] Added custom service: ${definition.id}`)
    },

    disconnect(): void {
      // Stop file watching
      if (stopFileWatching) {
        stopFileWatching()
        stopFileWatching = null
      }

      // Remove message listener
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

      // Disconnect additional VFS hosts
      for (const host of additionalVfsHosts) {
        host.disconnect()
      }
      additionalVfsHosts.length = 0

      connected = false

      console.log(`[SandboxConnection:${id}] Disconnected`)
    }
  }
}
