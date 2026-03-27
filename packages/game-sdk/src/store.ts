/**
 * GameStore — Zustand store for game state.
 *
 * Stores triples as a flat array. The backend pushes snapshot/change
 * events via the sandbox-client service API; the store applies them
 * and React re-renders automatically through zustand selectors.
 */

import { createStore } from 'zustand/vanilla'
import { initSandboxClient } from '@pubwiki/sandbox-client'
import type { Triple, MatchPattern, Value, ChangeEvent, SubscriptionEvent } from './types.ts'

// ── Triple matching ──

function tripleEquals(a: Triple, b: Triple): boolean {
  return (
    a.subject === b.subject &&
    a.predicate === b.predicate &&
    a.object === b.object &&
    (a.graph ?? undefined) === (b.graph ?? undefined)
  )
}

export function matchTriples(triples: Triple[], pattern: MatchPattern): Triple[] {
  return triples.filter((t) => {
    if (pattern.subject !== undefined && t.subject !== pattern.subject) return false
    if (pattern.predicate !== undefined && t.predicate !== pattern.predicate) return false
    if (pattern.object !== undefined && t.object !== pattern.object) return false
    if (pattern.graph !== undefined && t.graph !== pattern.graph) return false
    return true
  })
}

// ── Store shape ──

export interface GameState {
  triples: Triple[]
  connected: boolean
  /** Apply a full snapshot — replaces all triples */
  applySnapshot: (triples: Triple[]) => void
  /** Apply incremental changes */
  applyChanges: (events: ChangeEvent[]) => void
  /** Query */
  match: (pattern: MatchPattern) => Triple[]
  get: (subject: string, predicate: string, graph?: string) => Value | undefined
}

export function createGameStore() {
  return createStore<GameState>((set, get) => ({
    triples: [],
    connected: false,

    applySnapshot: (incoming: Triple[]) => {
      set({ triples: incoming })
    },

    applyChanges: (events: ChangeEvent[]) => {
      set((state) => {
        let triples = state.triples
        for (const e of events) {
          if (e.type === 'insert') {
            triples = [...triples, e.triple]
          } else {
            triples = triples.filter((t) => !tripleEquals(t, e.triple))
          }
        }
        return { triples }
      })
    },

    match: (pattern: MatchPattern) => matchTriples(get().triples, pattern),

    get: (subject: string, predicate: string, graph?: string) => {
      const found = get().triples.find(
        (t) =>
          t.subject === subject &&
          t.predicate === predicate &&
          (graph === undefined || t.graph === graph)
      )
      return found?.object
    },
  }))
}

export type GameStore = ReturnType<typeof createGameStore>

/**
 * Connect the store to the backend triple subscription.
 */
export async function connectStore(store: GameStore): Promise<void> {
  if (store.getState().connected) return
  store.setState({ connected: true })

  const client = initSandboxClient()
  const service = await client.getService('core:SubscribeTriples')

  if (!service) {
    console.error('[GameSDK] core:SubscribeTriples service not found')
    store.setState({ connected: false })
    return
  }

  // SubscribeTriples uses a callback-as-input pattern.
  // The sandbox-client automatically wraps functions as RPC stubs.
  service.call({
    callback: (event: unknown) => {
      const e = event as SubscriptionEvent
      if (e.type === 'snapshot') {
        store.getState().applySnapshot(e.triples)
      } else if (e.type === 'changes') {
        store.getState().applyChanges(e.events)
      }
    },
  }).catch((err: unknown) => {
    console.error('[GameSDK] subscription error:', err)
    store.setState({ connected: false })
  })

  // Wait briefly for the initial snapshot
  await new Promise<void>((resolve) => {
    const check = () => {
      if (store.getState().triples.length > 0) {
        resolve()
      } else {
        setTimeout(check, 50)
      }
    }
    setTimeout(resolve, 500)
    check()
  })
}
