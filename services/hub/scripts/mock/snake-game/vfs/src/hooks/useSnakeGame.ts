import { useState, useEffect, useCallback, useRef } from 'react'
import { Position, Direction, GameState } from '../types'
import { 
  moveSnake, 
  checkCollision, 
  checkFoodCollision, 
  generateFood,
  getOppositeDirection 
} from '../utils/gameLogic'

const GRID_SIZE = 20
const INITIAL_SPEED = 150
const SPEED_INCREMENT = 5
const MIN_SPEED = 50

export function useSnakeGame() {
  const [snake, setSnake] = useState<Position[]>([{ x: 10, y: 10 }])
  const [food, setFood] = useState<Position>({ x: 15, y: 15 })
  const [direction, setDirection] = useState<Direction>('RIGHT')
  const [gameState, setGameState] = useState<GameState>('idle')
  const [score, setScore] = useState(0)
  const [highScore, setHighScore] = useState(() => {
    const saved = localStorage.getItem('snakeHighScore')
    return saved ? parseInt(saved, 10) : 0
  })
  const [speed, setSpeed] = useState(INITIAL_SPEED)
  
  const directionRef = useRef(direction)
  const gameLoopRef = useRef<number | null>(null)
  
  // 更新方向引用
  useEffect(() => {
    directionRef.current = direction
  }, [direction])
  
  // 保存最高分
  useEffect(() => {
    localStorage.setItem('snakeHighScore', highScore.toString())
  }, [highScore])
  
  // 游戏主循环
  const gameLoop = useCallback(() => {
    setSnake(currentSnake => {
      const newSnake = moveSnake(currentSnake, directionRef.current)
      
      // 检查碰撞
      if (checkCollision(newSnake[0], GRID_SIZE, currentSnake)) {
        setGameState('gameOver')
        return currentSnake
      }
      
      // 检查是否吃到食物
      if (checkFoodCollision(newSnake[0], food)) {
        // 蛇变长（不移除尾部）
        const grownSnake = [newSnake[0], ...currentSnake]
        
        // 生成新食物
        setFood(generateFood(GRID_SIZE, grownSnake))
        
        // 增加分数
        setScore(s => {
          const newScore = s + 10
          setHighScore(h => Math.max(h, newScore))
          return newScore
        })
        
        // 加速
        setSpeed(s => Math.max(MIN_SPEED, s - SPEED_INCREMENT))
        
        return grownSnake
      }
      
      return newSnake
    })
  }, [food])
  
  // 启动/停止游戏循环
  useEffect(() => {
    if (gameState === 'playing') {
      const loop = () => {
        gameLoop()
        gameLoopRef.current = window.setTimeout(loop, speed)
      }
      gameLoopRef.current = window.setTimeout(loop, speed)
    }
    
    return () => {
      if (gameLoopRef.current) {
        clearTimeout(gameLoopRef.current)
      }
    }
  }, [gameState, speed, gameLoop])
  
  // 键盘控制
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameState !== 'playing' && gameState !== 'paused') {
        if (e.key === ' ' || e.key === 'Enter') {
          startGame()
        }
        return
      }
      
      const keyDirectionMap: Record<string, Direction> = {
        ArrowUp: 'UP',
        ArrowDown: 'DOWN',
        ArrowLeft: 'LEFT',
        ArrowRight: 'RIGHT',
        w: 'UP',
        W: 'UP',
        s: 'DOWN',
        S: 'DOWN',
        a: 'LEFT',
        A: 'LEFT',
        d: 'RIGHT',
        D: 'RIGHT',
      }
      
      const newDirection = keyDirectionMap[e.key]
      
      if (newDirection) {
        e.preventDefault()
        // 防止反向移动
        if (newDirection !== getOppositeDirection(directionRef.current)) {
          setDirection(newDirection)
        }
      }
      
      // 空格暂停/继续
      if (e.key === ' ') {
        e.preventDefault()
        if (gameState === 'playing') {
          pauseGame()
        } else if (gameState === 'paused') {
          resumeGame()
        }
      }
    }
    
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [gameState])
  
  const startGame = useCallback(() => {
    setSnake([{ x: 10, y: 10 }])
    setFood(generateFood(GRID_SIZE, [{ x: 10, y: 10 }]))
    setDirection('RIGHT')
    setScore(0)
    setSpeed(INITIAL_SPEED)
    setGameState('playing')
  }, [])
  
  const pauseGame = useCallback(() => {
    setGameState('paused')
  }, [])
  
  const resumeGame = useCallback(() => {
    setGameState('playing')
  }, [])
  
  const resetGame = useCallback(() => {
    startGame()
  }, [startGame])
  
  return {
    snake,
    food,
    score,
    highScore,
    gameState,
    gridSize: GRID_SIZE,
    startGame,
    pauseGame,
    resumeGame,
    resetGame,
  }
}
