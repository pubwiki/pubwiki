/**
 * HMR Service Implementation
 *
 * Simplified HMR service that only supports full reload.
 * Notifies sandbox to refresh when files change.
 */

import { RpcTarget } from '@pubwiki/sandbox-service'
import type { IHmrService, HmrUpdateCallback, HmrUpdate, HmrSubscription, RpcStub, ConsoleLogEntry } from '@pubwiki/sandbox-service'
import type { OnLogCallback } from '../types'

/**
 * HMR Service Implementation
 *
 * Runs on the main site, provides file change notifications to sandbox.
 */
export class HmrServiceImpl extends RpcTarget implements IHmrService {
  private callback: RpcStub<HmrUpdateCallback> | null = null
  private subscriptionId: string | null = null
  private logs: ConsoleLogEntry[] = []
  private onLogCallback: OnLogCallback | null = null
  private onUrlChangeCallback: ((path: string) => void) | null = null
  private readonly maxLogs = 500 // Limit stored logs

  constructor() {
    super()
    console.log(`[HmrServiceImpl] Created`)
  }

  /**
   * Set callback for log events (called by host)
   */
  setOnLogCallback(callback: OnLogCallback | null): void {
    this.onLogCallback = callback
  }

  /**
   * Set callback for URL change events (called by host)
   */
  setOnUrlChangeCallback(callback: ((path: string) => void) | null): void {
    this.onUrlChangeCallback = callback
  }

  /**
   * Get all stored logs
   */
  getLogs(): ConsoleLogEntry[] {
    return [...this.logs]
  }

  /**
   * Subscribe to HMR updates (only supports single subscriber - sandbox main page)
   */
  async subscribe(onUpdate: RpcStub<HmrUpdateCallback>): Promise<HmrSubscription> {
    const id = `hmr-${Date.now()}`
    
    // onUpdate is automatically disposed after this call is ended without calling dup explicitly
    // see https://github.com/cloudflare/capnweb?tab=readme-ov-file#duplicating-stubs
    this.callback = onUpdate.dup()
    this.subscriptionId = id

    console.log(`[HmrServiceImpl] Subscribed: ${id}`, this.callback)

    return {
      id,
      createdAt: Date.now()
    }
  }

  /**
   * Unsubscribe from updates
   */
  async unsubscribe(subscriptionId: string): Promise<void> {
    if (this.subscriptionId === subscriptionId) {
      this.callback = null
      this.subscriptionId = null
      console.log(`[HmrServiceImpl] Unsubscribed: ${subscriptionId}`)
    }
  }

  /**
   * Notify file update (called by main site)
   */
  notifyUpdate(update: HmrUpdate): void {
    if (this.callback) {
      try {
        console.log("[HmrServiceImpl] Invoke update callback", this.callback)
        this.callback(update)
          .then(() => console.log("[HmrServiceImpl] Invoke update callback sent"))
      } catch (error) {
        console.error(`[HmrServiceImpl] Callback error:`, error)
      }
    }
  }

  /**
   * Report a console log entry from sandbox (RPC method)
   */
  async reportLog(entry: ConsoleLogEntry): Promise<void> {
    console.log(`[HmrServiceImpl] Log received: [${entry.level}] ${entry.message.substring(0, 100)}`)
    
    // Store log
    this.logs.push(entry)
    
    // Trim if exceeds max
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs)
    }
    
    // Notify callback
    if (this.onLogCallback) {
      this.onLogCallback(entry)
    }
  }

  /**
   * Clear all stored logs (RPC method)
   */
  async clearLogs(): Promise<void> {
    console.log(`[HmrServiceImpl] Clearing ${this.logs.length} logs`)
    this.logs = []
  }

  /**
   * Report a URL change from the sandbox user iframe (RPC method)
   */
  async notifyUrlChange(path: string): Promise<void> {
    if (this.onUrlChangeCallback) {
      this.onUrlChangeCallback(path)
    }
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.callback = null
    this.subscriptionId = null
    this.logs = []
    this.onLogCallback = null
    this.onUrlChangeCallback = null
    console.log(`[HmrServiceImpl] Disposed`)
  }
}
