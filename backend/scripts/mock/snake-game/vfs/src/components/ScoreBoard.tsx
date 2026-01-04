interface ScoreBoardProps {
  score: number
  highScore: number
}

export function ScoreBoard({ score, highScore }: ScoreBoardProps) {
  return (
    <div className="score-board">
      <div className="score-item">
        <div className="label">当前得分</div>
        <div className="value">{score}</div>
      </div>
      <div className="score-item">
        <div className="label">最高得分</div>
        <div className="value">{highScore}</div>
      </div>
    </div>
  )
}
