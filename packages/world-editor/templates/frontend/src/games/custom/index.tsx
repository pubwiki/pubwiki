import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './custom.css'
// Import shared game services — these provide typed access to all backend APIs.
// See games/utils/gameServices.ts for the full list of available functions.
import { getGameState, createSave, loadSave, getPlayerEntity } from '../utils'

interface CustomGameProps {
  onBack: () => void
}

export default function CustomGame({ onBack }: CustomGameProps) {
  const { t } = useTranslation('game')
  const [gameState, setGameState] = useState<any>(null)

  return (
    <div className="custom-game-view">
      <div className="custom-header">
        <button className="btn-back" onClick={onBack}>{t('custom.back')}</button>
        <h1>{t('custom.title')}</h1>
      </div>

      <div className="custom-content">
        <div className="game-panel">
          <h2>{t('custom.contentArea')}</h2>
          <p>{t('custom.emptyTemplate')}</p>

          {/*
            可用的共享服务示例：
            - getGameState()       — 获取当前游戏状态快照
            - createSave(opts)     — 创建游戏存档
            - loadSave(id)         — 加载游戏存档
            - getPlayerEntity()    — 查询玩家实体
            - getNPCEntities()     — 查询所有NPC实体
            - updateGameStateAndDocs(input) — 更新游戏状态
            - creativeWritingStream(input)  — 流式创意写作
            更多服务请参考 games/utils/gameServices.ts
          */}
        </div>
      </div>
    </div>
  )
}
