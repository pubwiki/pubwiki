/**
 * Common types shared across sandbox-service interfaces
 */

/**
 * Result wrapper for operations that may fail
 */
export interface Result<T> {
  success: boolean
  data?: T
  error?: string
}

/**
 * Pagination parameters for list operations
 */
export interface PaginationParams {
  offset?: number
  limit?: number
}

/**
 * Generic list result with pagination info
 */
export interface ListResult<T> {
  items: T[]
  total: number
  hasMore: boolean
}

/**
 * Log level for sandbox console output
 */
export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * Console output message from sandbox
 */
export interface ConsoleMessage {
  level: LogLevel
  args: unknown[]
  timestamp: number
}

/**
 * Error information from sandbox
 */
export interface SandboxError {
  type: 'uncaught' | 'unhandledrejection' | 'compile' | 'runtime' | 'load'
  message: string
  filename?: string
  line?: number
  column?: number
  stack?: string
}

/**
 * Sandbox execution state
 */
export type SandboxState = 'initializing' | 'ready' | 'executing' | 'error' | 'disposed'

/**
 * Message types for sandbox communication
 * These are for simple postMessage communication, not RPC
 */
export type SandboxMessageType =
  | 'SANDBOX_READY'
  | 'SANDBOX_ERROR'
  | 'EXECUTE'
  | 'EXECUTE_SUCCESS'
  | 'EXECUTE_ERROR'
  | 'CONSOLE_OUTPUT'
  | 'HMR_UPDATE'
  | 'INJECT_API'

/**
 * Base sandbox message structure
 */
export interface SandboxMessage<T = unknown> {
  type: SandboxMessageType
  payload?: T
}
