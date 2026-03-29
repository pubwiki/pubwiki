import React from 'react'
import { createRoot } from 'react-dom/client'
import { GameProvider } from '@pubwiki/game-sdk'
import { GameDataProvider } from '@pubwiki/game-ui'
import App from './App.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <GameProvider>
    <GameDataProvider fallback={<div style={{ padding: '2rem', textAlign: 'center', color: '#8a847a' }}>连接游戏数据中…</div>}>
      <App />
    </GameDataProvider>
  </GameProvider>
)
