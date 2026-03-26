/**
 * GameProvider — React context for the GameStateManager.
 *
 * Wraps the app (or a game component) to provide access to the
 * reactive TripleStore via hooks like useCreatures(), usePlayer(), etc.
 */

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { GameStateManager } from './store'

const GameStoreContext = createContext<GameStateManager | null>(null)

export function useGameStore(): GameStateManager {
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
  const managerRef = useRef<GameStateManager | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const manager = new GameStateManager()
    managerRef.current = manager

    manager.connect()
      .then(() => setReady(true))
      .catch((err) => {
        console.error('[GameProvider] connection failed:', err)
        setError(String(err))
      })

    return () => {
      manager.dispose()
      managerRef.current = null
    }
  }, [])

  if (error) {
    return React.createElement('div', { style: { color: 'red', padding: 16 } },
      `Game SDK connection failed: ${error}`)
  }

  if (!ready || !managerRef.current) {
    return React.createElement('div', { style: { padding: 16 } },
      'Connecting to game state...')
  }

  return React.createElement(
    GameStoreContext.Provider,
    { value: managerRef.current },
    children
  )
}
