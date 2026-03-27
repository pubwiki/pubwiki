/**
 * GameProvider — Provides the zustand store and manages connection lifecycle.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createGameStore, connectStore, type GameStore } from './store.ts'

const GameStoreContext = createContext<GameStore | null>(null)

export function useGameStore(): GameStore {
  const store = useContext(GameStoreContext)
  if (!store) {
    throw new Error('useGameStore must be used within a <GameProvider>')
  }
  return store
}

interface GameProviderProps {
  children: React.ReactNode
}

export function GameProvider({ children }: GameProviderProps) {
  const storeRef = useRef<GameStore | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!storeRef.current) {
    storeRef.current = createGameStore()
  }

  useEffect(() => {
    const store = storeRef.current!

    connectStore(store)
      .then(() => setReady(true))
      .catch((err) => {
        console.error('[GameProvider] connection failed:', err)
        setError(String(err))
      })

    return () => {
      store.setState({ connected: false, triples: [] })
    }
  }, [])

  if (error) {
    return React.createElement('div', { style: { color: 'red', padding: 16 } },
      `Game SDK connection failed: ${error}`)
  }

  if (!ready) {
    return React.createElement('div', { style: { padding: 16 } },
      'Connecting to game state...')
  }

  return React.createElement(
    GameStoreContext.Provider,
    { value: storeRef.current },
    children
  )
}
