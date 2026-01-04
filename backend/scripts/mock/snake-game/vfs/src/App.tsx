import { useSnakeGame } from './hooks/useSnakeGame'
import { GameBoard } from './components/GameBoard'
import { ScoreBoard } from './components/ScoreBoard'

function App() {
  const {
    snake,
    food,
    score,
    highScore,
    gameState,
    gridSize,
    startGame,
    pauseGame,
    resumeGame,
    resetGame,
  } = useSnakeGame()

  return (
    <div className="app">
      <h1>🐍 贪吃蛇</h1>
      
      <ScoreBoard score={score} highScore={highScore} />
      
      <GameBoard
        snake={snake}
        food={food}
        gridSize={gridSize}
        gameState={gameState}
      />
      
      <div className="controls">
        {gameState === 'idle' && (
          <button onClick={startGame} className="btn btn-start">
            开始游戏
          </button>
        )}
        
        {gameState === 'playing' && (
          <button onClick={pauseGame} className="btn btn-pause">
            暂停
          </button>
        )}
        
        {gameState === 'paused' && (
          <button onClick={resumeGame} className="btn btn-resume">
            继续
          </button>
        )}
        
        {gameState === 'gameOver' && (
          <div className="game-over">
            <p>游戏结束！得分: {score}</p>
            <button onClick={resetGame} className="btn btn-restart">
              重新开始
            </button>
          </div>
        )}
      </div>
      
      <div className="instructions">
        <p>使用方向键 ↑ ↓ ← → 或 WASD 控制蛇的移动</p>
        <p>按空格键暂停/继续游戏</p>
      </div>
    </div>
  )
}

export default App
