/**
 * useDispatch — Send actions to the Lua backend.
 *
 * The dispatched action will modify the TripleStore,
 * which automatically pushes ChangeEvents to the frontend,
 * updating all reactive hooks.
 */

import { useCallback } from 'react'

/**
 * Returns a dispatch function for sending actions to the Lua backend.
 *
 * Usage:
 *   const dispatch = useDispatch()
 *   await dispatch('PlayerChoice', { choice_id: 'go_north' })
 */
export function useDispatch() {
  return useCallback(async (serviceName: string, params: Record<string, unknown> = {}) => {
    return window.callService(serviceName, params)
  }, [])
}
