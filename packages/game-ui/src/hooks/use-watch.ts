/**
 * useWatch — Generic hook for subscribing to a backend watch:* service.
 *
 * Two-phase strategy:
 * 1. Immediately calls an initial fetch service (e.g. state:GetStateFromGame)
 *    to populate data as fast as possible.
 * 2. Then subscribes to the watch:* streaming service for real-time updates.
 *
 * This ensures the first render has data without waiting for the watch
 * service's async subscription to establish.
 */

import { useState, useEffect, useRef } from 'react'
import { usePub } from '@pubwiki/game-sdk'

export interface WatchState<TData> {
  /** Current data snapshot (null until first push). */
  data: TData | null
  /** Whether the initial snapshot has been received. */
  ready: boolean
  /** Change metadata from the most recent push (null for snapshot/initial). */
  lastChange: {
    added?: string[]
    deleted?: string[]
    modified?: string[]
    [key: string]: unknown
  } | null
}

export interface UseWatchOptions<TEvent, TData, TInitResult> {
  /** Watch service namespace (e.g. "watch") */
  namespace: string
  /** Watch service name (e.g. "Creatures") */
  name: string
  /** Extract data from a watch callback event */
  extractData: (event: TEvent) => TData
  /**
   * Optional initial fetch — called immediately on mount to get data
   * before the watch stream establishes. Return the data to populate state,
   * or null to skip (watch stream will populate instead).
   */
  initialFetch?: (pub: ReturnType<typeof usePub>) => Promise<TData | null>
}

export function useWatch<
  TEvent extends { type: string; data: unknown },
  TData,
  TInitResult = TData
>(opts: UseWatchOptions<TEvent, TData, TInitResult>): WatchState<TData> {
  const pub = usePub()
  const [state, setState] = useState<WatchState<TData>>({
    data: null,
    ready: false,
    lastChange: null,
  })

  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => {
    let cancelled = false

    // Phase 1: Initial fetch (fast, one-shot)
    if (optsRef.current.initialFetch) {
      optsRef.current.initialFetch(pub)
        .then((data) => {
          if (!cancelled && data !== null) {
            setState((prev) => {
              // Don't overwrite if watch already delivered data
              if (prev.ready) return prev
              return { data, ready: true, lastChange: null }
            })
          }
        })
        .catch(() => { /* watch will deliver data as fallback */ })
    }

    // Phase 2: Watch stream (reactive, ongoing)
    const callback = (event: unknown) => {
      if (cancelled) return
      const e = event as TEvent
      const data = optsRef.current.extractData(e)

      if (e.type === 'snapshot') {
        setState({ data, ready: true, lastChange: null })
      } else {
        const { type: _t, data: _d, ...changeMeta } = e as Record<string, unknown>
        setState({ data, ready: true, lastChange: changeMeta })
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
