/**
 * Sandbox Types
 *
 * Type definitions for dual-channel RPC communication between
 * main site and sandbox iframe.
 *
 * Architecture:
 * - Main RPC Channel (ports[0]): HMR + WikiRAG for sandbox main page
 * - VFS RPC Channel (ports[1]): File access for Service Worker
 */

/**
 * Sandbox context information
 */
export interface SandboxContext {
  workspaceId: string
  basePath: string
  entryFile: string
  initialPath?: string
}

/**
 * Messages from main site to sandbox
 */
export type MainToSandboxMessage =
  | SandboxInitMessage

/**
 * Sandbox initialization message (dual channel)
 *
 * ports[0] = Main RPC port (HMR + WikiRAG for main page)
 * ports[1] = VFS RPC port (for Service Worker, direct to main site)
 */
export interface SandboxInitMessage {
  type: 'sandbox-init'
  workspaceId: string
  basePath: string
  entryFile?: string
  initialPath?: string
}

/**
 * Messages from sandbox to main site
 */
export type SandboxToMainMessage =
  | SandboxReadyMessage
  | RpcReadyMessage
  | SandboxReloadingMessage

/**
 * Sandbox ready message (sent on load)
 */
export interface SandboxReadyMessage {
  type: 'SANDBOX_READY'
}

/**
 * RPC ready message (sent after receiving sandbox-init)
 */
export interface RpcReadyMessage {
  type: 'RPC_READY'
}

/**
 * Sandbox is reloading message
 */
export interface SandboxReloadingMessage {
  type: 'SANDBOX_RELOADING'
}

/**
 * Messages from sandbox main page to Service Worker
 */
export type BootstrapToSwMessage =
  | SetupVfsRpcPortMessage
  | SkipWaitingMessage
  | PingMessage

/**
 * Setup VFS RPC port message
 * Transfers the direct VFS RPC port to Service Worker
 */
export interface SetupVfsRpcPortMessage {
  type: 'SETUP_VFS_RPC_PORT'
}

/**
 * Skip waiting message for SW update
 */
export interface SkipWaitingMessage {
  type: 'SKIP_WAITING'
}

/**
 * Ping message for health check
 */
export interface PingMessage {
  type: 'PING'
}

/**
 * Messages from Service Worker to sandbox main page
 */
export type SwToBootstrapMessage = PongMessage

/**
 * Pong response to ping
 */
export interface PongMessage {
  type: 'PONG'
  ready: boolean
}

/**
 * Global Window extensions
 */
declare global {
  interface Window {
    __sandboxContext?: SandboxContext
    __getMainRpcClient?: () => unknown
    __getSandboxContext?: () => SandboxContext | null
    __reloadSandbox?: () => void
    __waitForReady?: () => Promise<void>
  }
}
