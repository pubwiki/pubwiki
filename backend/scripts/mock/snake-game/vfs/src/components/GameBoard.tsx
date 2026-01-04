import { Position, GameState } from '../types'

interface GameBoardProps {
  snake: Position[]
  food: Position
  gridSize: number
  gameState: GameState
}

export function GameBoard({ snake, food, gridSize, gameState }: GameBoardProps) {
  const cells: JSX.Element[] = []
  
  for (let y = 0; y < gridSize; y++) {
    for (let x = 0; x < gridSize; x++) {
      const isSnakeHead = snake[0]?.x === x && snake[0]?.y === y
      const isSnakeBody = snake.some((segment, index) => 
        index > 0 && segment.x === x && segment.y === y
      )
      const isFood = food.x === x && food.y === y
      
      let className = 'cell'
      if (isSnakeHead) className += ' snake snake-head'
      else if (isSnakeBody) className += ' snake'
      else if (isFood) className += ' food'
      
      cells.push(
        <div
          key={`${x}-${y}`}
          className={className}
        />
      )
    }
  }
  
  return (
    <div 
      className="game-board"
      style={{
        gridTemplateColumns: `repeat(${gridSize}, 1fr)`,
        opacity: gameState === 'paused' ? 0.5 : 1,
      }}
    >
      {cells}
    </div>
  )
}
