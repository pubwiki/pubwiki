/**
 * HMR Service Interface
 *
 * Defines the RPC interface for Hot Module Replacement (HMR) operations.
 * This service allows sandbox applications to:
 * - Subscribe to file change notifications
 * - Receive HMR updates via callback
 *
 * Uses capnweb RpcTarget for type-safe RPC communication.
 * Callbacks are passed as functions - capnweb will automatically
 * create a stub that calls back over RPC when invoked.
 */

import type { HmrUpdate, HmrSubscription, ConsoleLogEntry } from '../types/hmr'

/**
 * Callback function type for HMR updates
 * This function is passed by the client and called by the server when files change
 */
export type HmrUpdateCallback = (update: HmrUpdate) => void

/**
 * HMR Service - runs on main site, consumed by sandbox apps
 *
 * Provides Hot Module Replacement capabilities to sandbox applications.
 * The service notifies when files are updated via a callback function.
 *
 * capnweb automatically handles the callback: when the server calls it,
 * an RPC is made back to the client where the callback was created.
 */
export interface IHmrService {
  /**
   * Subscribe to HMR updates for specific files or patterns
   * @param onUpdate - Callback function invoked when files change.
   *                   capnweb will create an RPC stub for this function,
   *                   so calls from server execute on the client.
   * @returns Subscription info with ID for unsubscribe
   *
   * @example
   * ```ts
   * const sub = await hmrService.subscribe(
   *   (update) => {
   *     console.log('File changed:', update.path)
   *     if (update.requiresFullReload) {
   *       window.location.reload()
   *     }
   *   }
   * )
   * ```
   */
  subscribe(
    onUpdate: HmrUpdateCallback
  ): Promise<HmrSubscription>

  /**
   * Unsubscribe from HMR updates
   * @param subscriptionId - ID returned from subscribe()
   */
  unsubscribe(subscriptionId: string): Promise<void>

  /**
   * Report a console log entry from the sandbox
   * @param entry - The console log entry to report
   */
  reportLog(entry: ConsoleLogEntry): Promise<void>

  /**
   * Clear all stored console logs
   */
  clearLogs(): Promise<void>

  /**
   * Report a URL change from the sandbox user iframe
   * @param path - The new path (pathname + search + hash)
   */
  notifyUrlChange(path: string): Promise<void>
}

