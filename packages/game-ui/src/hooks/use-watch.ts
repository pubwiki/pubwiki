/**
 * useWatch — Generic hook for subscribing to a backend watch:* service.
 *
 * Two-phase strategy:
 * 1. Immediately calls an initial fetch service to populate data fast.
 * 2. Subscribes to the watch:* streaming service for real-time updates.
 *
 * Supports incremental updates: snapshot events replace data entirely,
 * changes events are merged via a user-provided `mergeChanges` function.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePub } from '@pubwiki/game-sdk'

export interface WatchState<TData> {
  /** Current data (null until first push). */
  data: TData | null
  /** Whether the initial data has been received. */
  ready: boolean
  /** Raw change event metadata from the most recent push. */
  lastChange: Record<string, unknown> | null
}

export interface UseWatchOptions<TSnapshot, TData> {
  /** Watch service namespace (e.g. "watch") */
  namespace: string
  /** Watch service name (e.g. "Creatures") */
  name: string
  /** Extract data from a snapshot event. */
  extractSnapshot: (event: { type: 'snapshot'; data: TSnapshot }) => TData
  /**
   * Merge a changes event into current data.
   * Receives current data + the raw changes event, returns updated data.
   */
  mergeChanges: (current: TData, event: Record<string, unknown>) => TData
  /**
   * Optional initial fetch — called immediately on mount for fast first paint.
   */
  initialFetch?: (pub: ReturnType<typeof usePub>) => Promise<TData | null>
}

export function useWatch<TSnapshot, TData>(
  opts: UseWatchOptions<TSnapshot, TData>,
): WatchState<TData> {
  const pub = usePub()
  const [state, setState] = useState<WatchState<TData>>({
    data: null,
    ready: false,
    lastChange: null,
  })

  // Use ref so callbacks always see latest data without re-subscribing
  const dataRef = useRef<TData | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let cancelled = false

    // Phase 1: Initial fetch (fast, one-shot)
    if (optsRef.current.initialFetch) {
      const tag = `[useWatch] ${optsRef.current.namespace}:${optsRef.current.name}`
      optsRef.current.initialFetch(pub)
        .then((data) => {
          console.log(`${tag} initialFetch result:`, data)
          if (!cancelled && data !== null) {
            setState((prev) => {
              if (prev.ready) return prev
              dataRef.current = data
              return { data, ready: true, lastChange: null }
            })
          }
        })
        .catch((err) => { console.warn(`${tag} initialFetch failed:`, err) })
    }

    // Phase 2: Watch stream (reactive, ongoing)
    const callback = (event: unknown) => {
      if (cancelled) return
      const e = event as Record<string, unknown>
      const tag = `[useWatch] ${optsRef.current.namespace}:${optsRef.current.name}`

      if (e.type === 'snapshot') {
        console.log(`${tag} snapshot raw:`, e)
        const data = optsRef.current.extractSnapshot(e as { type: 'snapshot'; data: TSnapshot })
        console.log(`${tag} snapshot extracted:`, data)
        dataRef.current = data
        setState({ data, ready: true, lastChange: null })
      } else {
        console.log(`${tag} changes raw:`, e)
        const current = dataRef.current
        if (current !== null) {
          const merged = optsRef.current.mergeChanges(current, e)
          dataRef.current = merged
          const { type: _t, ...changeMeta } = e
          setState({ data: merged, ready: true, lastChange: changeMeta })
        } else {
          console.warn(`${tag} changes received before snapshot, skipping`)
        }
      }
    }

    const { namespace, name } = optsRef.current
    ;(pub as Record<string, Record<string, (inputs: unknown) => Promise<unknown>>>)
      [namespace]?.[name]?.({ callback })
      ?.catch((err: unknown) => {
        if (!cancelled) {
          console.error(`[useWatch] ${namespace}:${name} error:`, err)
        }
      })

    return () => { cancelled = true }
  }, [pub])

  return state
}
