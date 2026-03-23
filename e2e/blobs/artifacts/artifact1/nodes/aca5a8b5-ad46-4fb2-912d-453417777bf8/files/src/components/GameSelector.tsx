import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import './GameSelector.css'

interface GameInfo {
  id: string
  name: string
  description: string
  icon: string
  component: React.ComponentType<{ onBack: () => void }>
}

interface GameSelectorProps {
  onBack: () => void
  games: GameInfo[]
}

export default function GameSelector({ onBack, games }: GameSelectorProps) {
  const { t } = useTranslation('editor')
  const [selectedGame, setSelectedGame] = useState<string | null>(null)
  
  // 如果选择了游戏，渲染游戏组件
  if (selectedGame) {
    const game = games.find(g => g.id === selectedGame)
    if (game) {
      const GameComponent = game.component
      return <GameComponent onBack={() => setSelectedGame(null)} />
    }
  }
  
  // 否则显示游戏选择界面
  return (
    <div className="game-selector">
      <div className="selector-header">
        <h1>🎮 {t('gameSelector.title')}</h1>
        <button className="back-btn" onClick={onBack}>
          ← {t('gameSelector.backToEditor')}
        </button>
      </div>
      
      <div className="games-grid">
        {games.map(game => (
          <div 
            key={game.id}
            className="game-card"
            onClick={() => setSelectedGame(game.id)}
          >
            <div className="game-icon">{game.icon}</div>
            <h2 className="game-name">{game.name}</h2>
            <p className="game-description">{game.description}</p>
            <button className="play-btn">{t('gameSelector.startGame')}</button>
          </div>
        ))}
      </div>
      
      {games.length === 0 && (
        <div className="no-games">
          <p>{t('gameSelector.noGames')}</p>
        </div>
      )}
    </div>
  )
}
