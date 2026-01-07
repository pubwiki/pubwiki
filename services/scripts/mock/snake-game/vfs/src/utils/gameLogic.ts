import { Position, Direction } from '../types'

/**
 * 移动蛇
 */
export function moveSnake(snake: Position[], direction: Direction): Position[] {
  const head = snake[0]
  const newHead = { ...head }
  
  switch (direction) {
    case 'UP':
      newHead.y -= 1
      break
    case 'DOWN':
      newHead.y += 1
      break
    case 'LEFT':
      newHead.x -= 1
      break
    case 'RIGHT':
      newHead.x += 1
      break
  }
  
  // 新蛇 = 新头 + 原来的身体（去掉尾巴）
  return [newHead, ...snake.slice(0, -1)]
}

/**
 * 检查碰撞（墙壁或自身）
 */
export function checkCollision(
  head: Position, 
  gridSize: number, 
  snake: Position[]
): boolean {
  // 撞墙
  if (head.x < 0 || head.x >= gridSize || head.y < 0 || head.y >= gridSize) {
    return true
  }
  
  // 撞自己（检查头是否与身体重叠）
  for (let i = 1; i < snake.length; i++) {
    if (snake[i].x === head.x && snake[i].y === head.y) {
      return true
    }
  }
  
  return false
}

/**
 * 检查是否吃到食物
 */
export function checkFoodCollision(head: Position, food: Position): boolean {
  return head.x === food.x && head.y === food.y
}

/**
 * 生成新的食物位置（避开蛇身）
 */
export function generateFood(gridSize: number, snake: Position[]): Position {
  const availablePositions: Position[] = []
  
  for (let x = 0; x < gridSize; x++) {
    for (let y = 0; y < gridSize; y++) {
      const isOccupied = snake.some(segment => segment.x === x && segment.y === y)
      if (!isOccupied) {
        availablePositions.push({ x, y })
      }
    }
  }
  
  // 随机选择一个可用位置
  const randomIndex = Math.floor(Math.random() * availablePositions.length)
  return availablePositions[randomIndex] || { x: 0, y: 0 }
}

/**
 * 获取相反方向
 */
export function getOppositeDirection(direction: Direction): Direction {
  const opposites: Record<Direction, Direction> = {
    UP: 'DOWN',
    DOWN: 'UP',
    LEFT: 'RIGHT',
    RIGHT: 'LEFT',
  }
  return opposites[direction]
}
