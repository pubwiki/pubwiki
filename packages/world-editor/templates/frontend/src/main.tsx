import React from 'react'
import { createRoot } from 'react-dom/client'
import { GameProvider } from '@pubwiki/game-sdk'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <GameProvider>
    <App />
  </GameProvider>
)
