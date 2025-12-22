/**
 * HMR Service Implementation
 *
 * Simplified HMR service that only supports full reload.
 * Notifies sandbox to refresh when files change.
 */

import { RpcTarget } from '@pubwiki/sandbox-service'
import type { IHmrService, HmrUpdateCallback, HmrUpdate, HmrSubscription, RpcStub } from '@pubwiki/sandbox-service'

/**
 * HMR Service Implementation
 *
 * Runs on the main site, provides file change notifications to sandbox.
 */
export class HmrServiceImpl extends RpcTarget implements IHmrService {
  private callback: RpcStub<HmrUpdateCallback> | null = null
  private subscriptionId: string | null = null

  constructor() {
    super()
    console.log(`[HmrServiceImpl] Created`)
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
   * Cleanup resources
   */
  dispose(): void {
    this.callback = null
    this.subscriptionId = null
    console.log(`[HmrServiceImpl] Disposed`)
  }
}
