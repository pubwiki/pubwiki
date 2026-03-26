/**
 * GameStateManager — Frontend TripleStore Mirror
 *
 * Maintains a local TripleStore that mirrors the backend state.
 * Receives incremental ChangeEvent[] via the streaming subscription,
 * applies them to the local store, and exposes LiveQuery-based subscriptions.
 */

import { createTripleStore, type TripleStore, type LiveQuery } from '@pubwiki/rdfstore'
import type { Triple, MatchPattern, Value, ChangeEvent, SubscriptionEvent } from './types'

export class GameStateManager {
  private store: TripleStore
  private connected = false

  constructor() {
    this.store = createTripleStore()
  }

  /**
   * Connect to the backend triple subscription service.
   * Uses the same callback-as-input pattern as CreativeWritingStream.
   */
  async connect(): Promise<void> {
    if (this.connected) return
    this.connected = true

    // Fire-and-forget: the subscription runs indefinitely.
    // The callback fires for each snapshot/change event.
    window.callService('core:SubscribeTriples', {
      callback: (event: unknown) => {
        this.handleEvent(event as SubscriptionEvent)
      },
    }).catch((err: unknown) => {
      console.error('[GameStateManager] subscription error:', err)
      this.connected = false
    })

    // Wait briefly for the initial snapshot to arrive
    await new Promise<void>((resolve) => {
      const check = () => {
        if (this.store.getAll().length > 0) {
          resolve()
        } else {
          setTimeout(check, 50)
        }
      }
      // Resolve immediately if no data yet (empty store is valid)
      setTimeout(resolve, 500)
      check()
    })
  }

  private handleEvent(event: SubscriptionEvent): void {
    if (event.type === 'snapshot') {
      // Full snapshot: clear and rebuild
      this.store.clear()
      this.store.batchInsert(event.triples)
    } else if (event.type === 'changes') {
      // Incremental changes
      this.store.batch((writer) => {
        for (const e of event.events) {
          if (e.type === 'insert') {
            writer.insert(e.triple.subject, e.triple.predicate, e.triple.object, e.triple.graph)
          } else {
            writer.delete(e.triple.subject, e.triple.predicate, e.triple.object, e.triple.graph)
          }
        }
      })
    }
  }

  // ── Query API ──

  match(pattern: MatchPattern): Triple[] {
    return this.store.match(pattern)
  }

  get(subject: string, predicate: string, graph?: string): Value | undefined {
    return this.store.get(subject, predicate, graph)
  }

  getAll(): Triple[] {
    return this.store.getAll()
  }

  liveMatch(pattern: MatchPattern): LiveQuery<Triple[]> {
    return this.store.liveMatch(pattern)
  }

  liveGet(subject: string, predicate: string, graph?: string): LiveQuery<Value | undefined> {
    return this.store.liveGet(subject, predicate, graph)
  }

  get isConnected(): boolean {
    return this.connected
  }

  dispose(): void {
    this.connected = false
    this.store.close()
  }
}
