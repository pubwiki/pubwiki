export interface Position {
  x: number
  y: number
}

export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'

export type GameState = 'idle' | 'playing' | 'paused' | 'gameOver'
