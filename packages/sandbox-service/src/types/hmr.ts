/**
 * HMR (Hot Module Replacement) Types
 *
 * Type definitions for HMR service operations.
 */

/**
 * HMR update notification
 * Sent to subscribed clients when a file is updated
 */
export interface HmrUpdate {
  /** Type of update */
  type: 'update' | 'full-reload' | 'error'
  
  /** Timestamp of the update */
  timestamp: number
  
  /** File path that was updated */
  path: string
  
  /** List of affected modules (for partial updates) */
  affectedModules?: string[]
  
  /** New compiled code (for partial updates) */
  code?: string
  
  /** New compiled CSS (if any) */
  css?: string
  
  /** Error message (if type is 'error') */
  error?: string
  
  /** Structured error list for build failures */
  errors?: Array<{
    file: string
    line: number
    column: number
    message: string
    snippet?: string
  }>
  
  /** Whether a full page reload is recommended */
  requiresFullReload?: boolean
}

/**
 * HMR subscription info
 * Returned when subscribing to updates
 */
export interface HmrSubscription {
  /** Unique subscription ID */
  id: string
  
  /** Subscription creation timestamp */
  createdAt: number
}

/**
 * Console log level
 */
export type ConsoleLogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * Console log entry reported from sandbox
 */
export interface ConsoleLogEntry {
  /** Log level */
  level: ConsoleLogLevel
  
  /** Timestamp when log was created */
  timestamp: number
  
  /** Log message (serialized arguments) */
  message: string
  
  /** Stack trace (for errors) */
  stack?: string
}
